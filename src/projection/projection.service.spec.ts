/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { Message } from '../event/entities/message.entity';
import { EventType } from '../event/event-type';
import { SessionState } from '../session/session.reducer';
import { Snapshot } from './entities/snapshot.entity';
import { ProjectionRepository } from './projection.repository';
import { ProjectionService } from './projection.service';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';
const AT = new Date('2026-10-19T06:25:00.000Z');

function message(
  seq: number,
  type: EventType,
  actorId: string,
  payload: Record<string, unknown> = {},
): Message {
  return {
    id: seq,
    sessionId: SESSION_ID,
    seq,
    type,
    actorId,
    clientEventId: null,
    payload,
    clientSentAt: null,
    receivedAt: new Date(Date.UTC(2026, 9, 19, 6, 20, seq)),
  } as Message;
}

const created = [
  message(1, EventType.SESSION_CREATED, 'user-a', { title: '상담' }),
  message(2, EventType.PARTICIPANT_JOINED, 'user-a'),
];

describe('ProjectionService.restoreTimeline', () => {
  let service: ProjectionService;
  let repo: jest.Mocked<ProjectionRepository>;

  beforeEach(() => {
    repo = {
      findLastSeqAt: jest.fn(),
      findLatestSnapshot: jest.fn().mockResolvedValue(null),
      findEvents: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ProjectionRepository>;
    service = new ProjectionService(repo);
  });

  it('at까지의 마지막 seq를 기준으로 삼는다', async () => {
    repo.findLastSeqAt.mockResolvedValue(3);
    repo.findEvents.mockResolvedValue([
      ...created,
      message(3, EventType.MESSAGE_CREATED, 'user-a', { content: '안녕' }),
    ]);

    const result = await service.restoreTimeline(SESSION_ID, AT);

    expect(repo.findLastSeqAt).toHaveBeenCalledWith(SESSION_ID, AT);
    expect(result).toEqual({
      sessionId: SESSION_ID,
      at: '2026-10-19T06:25:00.000Z',
      seq: 3,
      state: {
        status: 'JOIN',
        participants: [
          {
            userId: 'user-a',
            joinedAt: '2026-10-19T06:20:02.000Z',
            leftAt: null,
            presence: 'OFFLINE',
          },
        ],
        messageCount: 1,
        lastMessage: {
          seq: 3,
          actorId: 'user-a',
          content: '안녕',
          receivedAt: '2026-10-19T06:20:03.000Z',
        },
      },
    });
  });

  it('스냅샷이 없으면 빈 상태에서 1번 이벤트부터 적용한다', async () => {
    repo.findLastSeqAt.mockResolvedValue(2);
    repo.findEvents.mockResolvedValue(created);

    await service.restoreTimeline(SESSION_ID, AT);

    expect(repo.findLatestSnapshot).toHaveBeenCalledWith(SESSION_ID, 2);
    expect(repo.findEvents).toHaveBeenCalledWith(SESSION_ID, 0, 2);
  });

  it('스냅샷이 있으면 스냅샷 상태에서 이후 이벤트만 적용한다', async () => {
    const snapshotState: SessionState = {
      status: 'JOIN',
      participants: [
        {
          userId: 'user-a',
          joinedAt: '2026-10-19T06:00:00.000Z',
          leftAt: null,
          presence: 'ONLINE',
        },
        {
          userId: 'user-b',
          joinedAt: '2026-10-19T06:00:01.000Z',
          leftAt: null,
          presence: 'OFFLINE',
        },
      ],
      messageCount: 96,
      lastMessage: null,
    };
    repo.findLastSeqAt.mockResolvedValue(102);
    repo.findLatestSnapshot.mockResolvedValue({
      sessionId: SESSION_ID,
      seq: 100,
      state: snapshotState,
    } as Snapshot);
    repo.findEvents.mockResolvedValue([
      message(101, EventType.MESSAGE_CREATED, 'user-b', { content: '답장' }),
      message(102, EventType.PARTICIPANT_LEFT, 'user-b'),
    ]);

    const result = await service.restoreTimeline(SESSION_ID, AT);

    expect(repo.findEvents).toHaveBeenCalledWith(SESSION_ID, 100, 102);
    expect(result.seq).toBe(102);
    expect(result.state.status).toBe('LEAVE');
    expect(result.state.messageCount).toBe(97);
    expect(result.state.lastMessage?.seq).toBe(101);
    // 스냅샷에 담긴 presence가 유지된다.
    expect(result.state.participants[0].presence).toBe('ONLINE');
    // 스냅샷 객체를 바꾸지 않는다.
    expect(snapshotState.messageCount).toBe(96);
  });

  it('기준 seq의 스냅샷이 있으면 이벤트를 적용하지 않고 그대로 쓴다', async () => {
    const state: SessionState = {
      status: 'END',
      participants: [],
      messageCount: 3,
      lastMessage: null,
    };
    repo.findLastSeqAt.mockResolvedValue(7);
    repo.findLatestSnapshot.mockResolvedValue({ seq: 7, state } as Snapshot);

    const result = await service.restoreTimeline(SESSION_ID, AT);

    expect(repo.findEvents).toHaveBeenCalledWith(SESSION_ID, 7, 7);
    expect(result.state).toEqual(state);
  });

  it('at 이전 이벤트가 없으면(세션 생성 이전, 없는 세션) SESSION_NOT_FOUND', async () => {
    repo.findLastSeqAt.mockResolvedValue(null);

    await expect(service.restoreTimeline(SESSION_ID, AT)).rejects.toEqual(
      expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
    );
    expect(repo.findLatestSnapshot).not.toHaveBeenCalled();
  });
});
