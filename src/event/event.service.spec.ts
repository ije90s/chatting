/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { DataSource, EntityManager } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { Participant } from '../session/entities/participant.entity';
import { Session } from '../session/entities/session.entity';
import { Message } from './entities/message.entity';
import { EventType } from './event-type';
import { EventRepository } from './event.repository';
import { EventService } from './event.service';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';
const T0 = new Date('2026-10-19T06:00:00.000Z');
const NOW = new Date('2026-10-19T06:20:00.123Z');

function session(changes: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    title: '상담',
    status: 'JOIN',
    createdBy: 'user-a',
    lastSeq: 3,
    participantCount: 2,
    messageCount: 0,
    lastMessageSeq: null,
    createdAt: T0,
    endedAt: null,
    updatedAt: T0,
    ...changes,
  } as Session;
}

function participant(userId: string, changes: Partial<Participant> = {}) {
  return {
    sessionId: SESSION_ID,
    userId,
    joinedAt: T0,
    leftAt: null,
    presence: 'OFFLINE',
    presenceAt: null,
    ...changes,
  } as Participant;
}

function message(changes: Partial<Message>): Message {
  return {
    id: 100,
    sessionId: SESSION_ID,
    seq: 1,
    type: EventType.MESSAGE_CREATED,
    actorId: 'user-a',
    clientEventId: null,
    payload: {},
    clientSentAt: null,
    receivedAt: T0,
    ...changes,
  } as Message;
}

describe('EventService', () => {
  let service: EventService;
  let repo: jest.Mocked<EventRepository>;
  const manager = {} as EntityManager;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    repo = {
      lockSession: jest.fn().mockResolvedValue(session()),
      findParticipants: jest
        .fn()
        .mockResolvedValue([participant('user-a'), participant('user-b')]),
      findEventBySeq: jest.fn().mockResolvedValue(null),
      findEventByClientEventId: jest.fn().mockResolvedValue(null),
      findLatestEvent: jest.fn().mockResolvedValue(null),
      insertSession: jest.fn(),
      updateSession: jest.fn(),
      upsertParticipant: jest.fn(),
      insertEvent: jest.fn((_m, event: Omit<Message, 'id' | 'session'>) =>
        Promise.resolve({ ...event, id: 200 } as Message),
      ),
    };
    const dataSource = {
      transaction: jest.fn((work: (m: EntityManager) => unknown) =>
        work(manager),
      ),
    } as unknown as DataSource;
    service = new EventService(dataSource, repo);
  });

  afterEach(() => jest.useRealTimers());

  describe('append', () => {
    const sendMessage = {
      type: EventType.MESSAGE_CREATED,
      actorId: 'user-a',
      clientEventId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      payload: { content: '안녕하세요' },
      clientSentAt: new Date('2026-10-19T06:20:00.100Z'),
    } as const;

    it('잠근 세션의 last_seq + 1을 seq로 부여해 저장한다', async () => {
      const result = await service.append(SESSION_ID, sendMessage);

      expect(repo.lockSession).toHaveBeenCalledWith(manager, SESSION_ID);
      expect(result).toEqual({
        created: true,
        event: {
          eventId: 200,
          sessionId: SESSION_ID,
          seq: 4,
          type: 'MESSAGE_CREATED',
          actorId: 'user-a',
          clientEventId: sendMessage.clientEventId,
          payload: { content: '안녕하세요' },
          clientSentAt: '2026-10-19T06:20:00.100Z',
          receivedAt: NOW.toISOString(),
        },
      });
    });

    it('이벤트와 같은 트랜잭션에서 세션 프로젝션을 갱신한다', async () => {
      await service.append(SESSION_ID, sendMessage);

      expect(repo.updateSession).toHaveBeenCalledWith(manager, SESSION_ID, {
        status: 'JOIN',
        lastSeq: 4,
        participantCount: 2,
        messageCount: 1,
        lastMessageSeq: 4,
        updatedAt: NOW,
      });
      // 메시지는 참여자 행을 바꾸지 않는다.
      expect(repo.upsertParticipant).not.toHaveBeenCalled();
    });

    it('이미 저장된 clientEventId면 저장하지 않고 기존 이벤트를 돌려준다', async () => {
      const existing = message({
        seq: 2,
        clientEventId: sendMessage.clientEventId,
        payload: { content: '안녕하세요' },
      });
      repo.findEventByClientEventId.mockResolvedValue(existing);

      const result = await service.append(SESSION_ID, sendMessage);

      expect(result.created).toBe(false);
      expect(result.event.seq).toBe(2);
      expect(repo.insertEvent).not.toHaveBeenCalled();
      expect(repo.updateSession).not.toHaveBeenCalled();
    });

    it('중복 확인은 상태 검증보다 먼저 한다 (END 세션에도 기존 이벤트 반환)', async () => {
      repo.lockSession.mockResolvedValue(session({ status: 'END' }));
      repo.findEventByClientEventId.mockResolvedValue(
        message({ clientEventId: sendMessage.clientEventId }),
      );

      await expect(service.append(SESSION_ID, sendMessage)).resolves.toEqual(
        expect.objectContaining({ created: false }),
      );
    });

    it('중복 확인은 세션을 잠근 뒤에 한다', async () => {
      await service.append(SESSION_ID, sendMessage);
      expect(repo.lockSession.mock.invocationCallOrder[0]).toBeLessThan(
        repo.findEventByClientEventId.mock.invocationCallOrder[0],
      );
    });

    it('반영된 상태인데 해당 이벤트가 없으면 데이터 불일치로 실패한다', async () => {
      repo.findLatestEvent.mockResolvedValue(null);
      await expect(
        service.append(SESSION_ID, {
          type: EventType.PARTICIPANT_JOINED,
          actorId: 'user-b',
        }),
      ).rejects.toThrow('반영된 PARTICIPANT_JOINED 이벤트가 없습니다');
    });

    it('세션이 없으면 SESSION_NOT_FOUND', async () => {
      repo.lockSession.mockResolvedValue(null);
      await expect(service.append(SESSION_ID, sendMessage)).rejects.toEqual(
        expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
      );
    });

    it('상태 검증에 실패하면 아무것도 저장하지 않는다', async () => {
      repo.lockSession.mockResolvedValue(session({ status: 'END' }));

      const error = await service
        .append(SESSION_ID, sendMessage)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('INVALID_SESSION_STATUS');
      expect(repo.insertEvent).not.toHaveBeenCalled();
      expect(repo.updateSession).not.toHaveBeenCalled();
    });

    it('프로젝션의 마지막 메시지를 상태에 넣어 메시지 수를 이어서 센다', async () => {
      repo.lockSession.mockResolvedValue(
        session({ messageCount: 5, lastMessageSeq: 3 }),
      );
      repo.findEventBySeq.mockResolvedValue(
        message({ seq: 3, payload: { content: '이전' } }),
      );

      await service.append(SESSION_ID, sendMessage);

      expect(repo.findEventBySeq).toHaveBeenCalledWith(manager, SESSION_ID, 3);
      expect(repo.updateSession).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        expect.objectContaining({ messageCount: 6, lastMessageSeq: 4 }),
      );
    });

    it('이미 참여 중인 사용자의 join은 기존 PARTICIPANT_JOINED를 돌려준다', async () => {
      const joined = message({
        seq: 3,
        type: EventType.PARTICIPANT_JOINED,
        actorId: 'user-b',
      });
      repo.findLatestEvent.mockResolvedValue(joined);

      const result = await service.append(SESSION_ID, {
        type: EventType.PARTICIPANT_JOINED,
        actorId: 'user-b',
      });

      expect(result).toEqual({
        created: false,
        event: expect.objectContaining({ seq: 3 }) as unknown,
      });
      expect(repo.findLatestEvent).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        'PARTICIPANT_JOINED',
        'user-b',
      );
      expect(repo.insertEvent).not.toHaveBeenCalled();
    });

    it('END 세션의 end는 행위자와 무관하게 기존 SESSION_ENDED를 돌려준다', async () => {
      repo.lockSession.mockResolvedValue(session({ status: 'END' }));
      repo.findLatestEvent.mockResolvedValue(
        message({ seq: 9, type: EventType.SESSION_ENDED, actorId: 'user-b' }),
      );

      const result = await service.append(SESSION_ID, {
        type: EventType.SESSION_ENDED,
        actorId: 'user-a',
      });

      expect(result.created).toBe(false);
      expect(repo.findLatestEvent).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        'SESSION_ENDED',
        undefined,
      );
    });

    it('leave는 세션을 LEAVE로 바꾸고 참여자 행에 leftAt을 저장한다', async () => {
      await service.append(SESSION_ID, {
        type: EventType.PARTICIPANT_LEFT,
        actorId: 'user-b',
        clientEventId: '7a1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      });

      expect(repo.updateSession).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        expect.objectContaining({ status: 'LEAVE', lastSeq: 4 }),
      );
      expect(repo.upsertParticipant).toHaveBeenCalledWith(manager, {
        sessionId: SESSION_ID,
        userId: 'user-b',
        joinedAt: T0,
        leftAt: NOW,
        presence: 'OFFLINE',
      });
    });

    it('end는 ended_at을 기록한다', async () => {
      await service.append(SESSION_ID, {
        type: EventType.SESSION_ENDED,
        actorId: 'user-a',
      });

      expect(repo.updateSession).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        expect.objectContaining({ status: 'END', endedAt: NOW }),
      );
    });

    it('presence는 참여자 행의 presence와 presence_at을 갱신한다', async () => {
      await service.append(SESSION_ID, {
        type: EventType.PRESENCE_ONLINE,
        actorId: 'user-a',
        payload: { socketId: 's1' },
      });

      expect(repo.upsertParticipant).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          userId: 'user-a',
          presence: 'ONLINE',
          presenceAt: NOW,
        }),
      );
      expect(repo.updateSession).toHaveBeenCalledWith(
        manager,
        SESSION_ID,
        expect.objectContaining({ status: 'JOIN', lastSeq: 4 }),
      );
    });
  });

  describe('createSession', () => {
    it('SESSION_CREATED(seq 1)와 생성자의 PARTICIPANT_JOINED(seq 2)를 저장한다', async () => {
      const events = await service.createSession({
        title: '상담 문의',
        actorId: 'user-a',
      });

      expect(events.map((e) => [e.seq, e.type, e.actorId])).toEqual([
        [1, 'SESSION_CREATED', 'user-a'],
        [2, 'PARTICIPANT_JOINED', 'user-a'],
      ]);
      expect(events[0].payload).toEqual({ title: '상담 문의' });
      // UUID v7
      expect(events[0].sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(events[1].sessionId).toBe(events[0].sessionId);
    });

    it('세션 행을 이벤트 적용 결과로 만들고 생성자를 참여자로 저장한다', async () => {
      const [created] = await service.createSession({
        title: '상담 문의',
        actorId: 'user-a',
      });

      expect(repo.insertSession).toHaveBeenCalledWith(manager, {
        id: created.sessionId,
        title: '상담 문의',
        createdBy: 'user-a',
        createdAt: NOW,
        status: 'JOIN',
        lastSeq: 2,
        participantCount: 1,
        messageCount: 0,
        lastMessageSeq: null,
        updatedAt: NOW,
        endedAt: null,
      });
      expect(repo.upsertParticipant).toHaveBeenCalledWith(manager, {
        sessionId: created.sessionId,
        userId: 'user-a',
        joinedAt: NOW,
        leftAt: null,
        presence: 'OFFLINE',
      });
    });
  });
});
