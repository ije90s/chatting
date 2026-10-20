/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { EventDto } from '../event/dto/event.dto';
import { EventType } from '../event/event-type';
import { EventService } from '../event/event.service';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';
import { decodeCursor, encodeCursor } from './session-cursor';
import { Presence, SessionStatus } from './session-status';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';
const CREATED_AT = new Date('2026-10-19T06:00:00.000Z');

describe('SessionService.create', () => {
  let service: SessionService;
  let eventService: jest.Mocked<EventService>;
  let repo: jest.Mocked<SessionRepository>;

  beforeEach(() => {
    eventService = {
      createSession: jest.fn().mockResolvedValue([
        { sessionId: SESSION_ID, seq: 1 },
        { sessionId: SESSION_ID, seq: 2 },
      ] as EventDto[]),
    } as unknown as jest.Mocked<EventService>;
    repo = {
      findById: jest.fn().mockResolvedValue({
        id: SESSION_ID,
        title: '상담 문의',
        status: SessionStatus.JOIN,
        createdBy: 'user-a',
        lastSeq: '2',
        createdAt: CREATED_AT,
        endedAt: null,
      }),
      findParticipants: jest.fn().mockResolvedValue([
        {
          sessionId: SESSION_ID,
          userId: 'user-a',
          joinedAt: CREATED_AT,
          leftAt: null,
          presence: Presence.OFFLINE,
        } as Participant,
      ]),
    } as unknown as jest.Mocked<SessionRepository>;
    service = new SessionService(eventService, repo);
  });

  it('요청자를 생성자로 EventService에 넘긴다', async () => {
    await service.create('user-a', '상담 문의');
    expect(eventService.createSession).toHaveBeenCalledWith({
      title: '상담 문의',
      actorId: 'user-a',
    });
  });

  it('저장된 프로젝션을 세션 형식으로 돌려준다', async () => {
    await expect(service.create('user-a', '상담 문의')).resolves.toEqual({
      id: SESSION_ID,
      title: '상담 문의',
      status: 'JOIN',
      createdBy: 'user-a',
      participants: [
        {
          userId: 'user-a',
          joinedAt: '2026-10-19T06:00:00.000Z',
          leftAt: null,
          presence: 'OFFLINE',
        },
      ],
      lastSeq: 2,
      createdAt: '2026-10-19T06:00:00.000Z',
      endedAt: null,
    });
  });

  it('저장 실패는 그대로 전파하고 조회하지 않는다', async () => {
    eventService.createSession.mockRejectedValue(new Error('db down'));
    await expect(service.create('user-a', '상담 문의')).rejects.toThrow(
      'db down',
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

describe('SessionService.join', () => {
  it('요청자의 PARTICIPANT_JOINED를 EventService에 넘기고 결과를 그대로 돌려준다', async () => {
    const result = { event: { seq: 3 } as EventDto, created: true };
    const eventService = {
      append: jest.fn().mockResolvedValue(result),
    } as unknown as jest.Mocked<EventService>;
    const service = new SessionService(eventService, {} as SessionRepository);

    await expect(service.join(SESSION_ID, 'user-b')).resolves.toBe(result);
    expect(eventService.append).toHaveBeenCalledWith(SESSION_ID, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: 'user-b',
    });
  });
});

describe('SessionService.appendEvent', () => {
  let service: SessionService;
  let eventService: jest.Mocked<EventService>;
  const CLIENT_EVENT_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

  beforeEach(() => {
    eventService = {
      append: jest.fn().mockResolvedValue({ event: {}, created: true }),
    } as unknown as jest.Mocked<EventService>;
    service = new SessionService(eventService, {} as SessionRepository);
  });

  it('메시지는 content만 payload로 넘기고 clientSentAt을 Date로 바꾼다', async () => {
    await service.appendEvent(SESSION_ID, 'user-a', {
      clientEventId: CLIENT_EVENT_ID,
      type: EventType.MESSAGE_CREATED,
      payload: { content: '안녕하세요' },
      clientSentAt: '2026-10-19T15:20:00.100+09:00',
    });
    expect(eventService.append).toHaveBeenCalledWith(SESSION_ID, {
      type: EventType.MESSAGE_CREATED,
      actorId: 'user-a',
      clientEventId: CLIENT_EVENT_ID,
      payload: { content: '안녕하세요' },
      clientSentAt: new Date('2026-10-19T06:20:00.100Z'),
    });
  });

  it('나가기는 빈 payload로 넘기고, clientSentAt이 없으면 null', async () => {
    await service.appendEvent(SESSION_ID, 'user-a', {
      clientEventId: CLIENT_EVENT_ID,
      type: EventType.PARTICIPANT_LEFT,
    });
    expect(eventService.append).toHaveBeenCalledWith(SESSION_ID, {
      type: EventType.PARTICIPANT_LEFT,
      actorId: 'user-a',
      clientEventId: CLIENT_EVENT_ID,
      payload: {},
      clientSentAt: null,
    });
  });
});

describe('SessionService.end', () => {
  it('요청자의 SESSION_ENDED를 EventService에 넘기고 결과를 그대로 돌려준다', async () => {
    const result = { event: { seq: 4 } as EventDto, created: false };
    const eventService = {
      append: jest.fn().mockResolvedValue(result),
    } as unknown as jest.Mocked<EventService>;
    const service = new SessionService(eventService, {} as SessionRepository);

    await expect(service.end(SESSION_ID, 'user-a')).resolves.toBe(result);
    expect(eventService.append).toHaveBeenCalledWith(SESSION_ID, {
      type: EventType.SESSION_ENDED,
      actorId: 'user-a',
    });
  });
});

describe('SessionService.list', () => {
  let service: SessionService;
  let repo: jest.Mocked<SessionRepository>;

  function session(n: number): Session {
    return {
      id: `0192a3b4-0000-7000-8000-00000000000${n}`,
      title: `세션 ${n}`,
      status: SessionStatus.JOIN,
      createdBy: 'user-a',
      lastSeq: 2,
      createdAt: new Date(Date.UTC(2026, 9, 19, 6, 0, 10 - n)),
      endedAt: null,
    } as Session;
  }

  function participant(n: number, userId: string): Participant {
    return {
      sessionId: session(n).id,
      userId,
      joinedAt: CREATED_AT,
      leftAt: null,
      presence: Presence.OFFLINE,
    } as Participant;
  }

  beforeEach(() => {
    repo = {
      findPage: jest.fn().mockResolvedValue([]),
      findParticipantsOf: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SessionRepository>;
    service = new SessionService({} as EventService, repo);
  });

  it('필터를 변환해 limit + 1건을 조회한다', async () => {
    const cursor = encodeCursor({ createdAt: CREATED_AT, id: SESSION_ID });
    await service.list({
      status: [SessionStatus.JOIN, SessionStatus.END],
      participantId: 'user-a',
      from: '2026-10-19T00:00:00.000Z',
      to: '2026-10-20T00:00:00.000Z',
      cursor,
      limit: 5,
    });
    expect(repo.findPage).toHaveBeenCalledWith({
      statuses: ['JOIN', 'END'],
      participantId: 'user-a',
      from: new Date('2026-10-19T00:00:00.000Z'),
      to: new Date('2026-10-20T00:00:00.000Z'),
      cursor: { createdAt: CREATED_AT, id: SESSION_ID },
      limit: 6,
    });
  });

  it('limit이 없으면 20건(조회는 21건)', async () => {
    await service.list({});
    expect(repo.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 21 }),
    );
  });

  it('한 건이 더 있으면 limit건만 돌려주고 마지막 항목으로 nextCursor를 만든다', async () => {
    repo.findPage.mockResolvedValue([session(1), session(2), session(3)]);
    const result = await service.list({ limit: 2 });

    expect(result.items.map((s) => s.id)).toEqual([
      session(1).id,
      session(2).id,
    ]);
    expect(decodeCursor(result.nextCursor!)).toEqual({
      createdAt: session(2).createdAt,
      id: session(2).id,
    });
    expect(repo.findParticipantsOf).toHaveBeenCalledWith([
      session(1).id,
      session(2).id,
    ]);
  });

  it('더 없으면 nextCursor는 null', async () => {
    repo.findPage.mockResolvedValue([session(1), session(2)]);
    expect((await service.list({ limit: 2 })).nextCursor).toBeNull();
  });

  it('참여자를 세션별로 나눠 담는다', async () => {
    repo.findPage.mockResolvedValue([session(1), session(2)]);
    repo.findParticipantsOf.mockResolvedValue([
      participant(1, 'user-a'),
      participant(2, 'user-a'),
      participant(1, 'user-b'),
    ]);
    const { items } = await service.list({});
    expect(items[0].participants.map((p) => p.userId)).toEqual([
      'user-a',
      'user-b',
    ]);
    expect(items[1].participants.map((p) => p.userId)).toEqual(['user-a']);
  });

  it('결과가 없으면 참여자를 조회하지 않는다', async () => {
    await expect(service.list({})).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(repo.findParticipantsOf).not.toHaveBeenCalled();
  });

  it('잘못된 커서는 조회 전에 VALIDATION_ERROR', async () => {
    await expect(service.list({ cursor: '!!!' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(repo.findPage).not.toHaveBeenCalled();
  });
});

describe('SessionService.requireParticipant', () => {
  let service: SessionService;
  let repo: jest.Mocked<SessionRepository>;

  beforeEach(() => {
    repo = {
      findById: jest.fn().mockResolvedValue({ id: SESSION_ID }),
      findParticipant: jest.fn().mockResolvedValue({
        sessionId: SESSION_ID,
        userId: 'user-a',
        leftAt: null,
      }),
    } as unknown as jest.Mocked<SessionRepository>;
    service = new SessionService({} as EventService, repo);
  });

  it('참여자면 통과한다', async () => {
    await expect(
      service.requireParticipant(SESSION_ID, 'user-a'),
    ).resolves.toBeUndefined();
    expect(repo.findParticipant).toHaveBeenCalledWith(SESSION_ID, 'user-a');
  });

  it('나간 참여자도 통과한다', async () => {
    repo.findParticipant.mockResolvedValue({
      sessionId: SESSION_ID,
      userId: 'user-a',
      leftAt: CREATED_AT,
    } as Participant);
    await expect(
      service.requireParticipant(SESSION_ID, 'user-a'),
    ).resolves.toBeUndefined();
  });

  it('세션이 없으면 SESSION_NOT_FOUND', async () => {
    repo.findById.mockResolvedValue(null);
    repo.findParticipant.mockResolvedValue(null);
    await expect(
      service.requireParticipant(SESSION_ID, 'user-a'),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('참여 기록이 없으면 NOT_PARTICIPANT', async () => {
    repo.findParticipant.mockResolvedValue(null);
    await expect(
      service.requireParticipant(SESSION_ID, 'user-c'),
    ).rejects.toMatchObject({ code: 'NOT_PARTICIPANT' });
  });
});

describe('SessionService.findOnlineParticipants', () => {
  it('ONLINE 참여자의 세션·사용자만 돌려준다', async () => {
    const repo = {
      findByPresence: jest.fn().mockResolvedValue([
        {
          sessionId: SESSION_ID,
          userId: 'user-a',
          presence: Presence.ONLINE,
        } as Participant,
      ]),
    } as unknown as jest.Mocked<SessionRepository>;
    const service = new SessionService({} as EventService, repo);

    await expect(service.findOnlineParticipants()).resolves.toEqual([
      { sessionId: SESSION_ID, userId: 'user-a' },
    ]);
    expect(repo.findByPresence).toHaveBeenCalledWith('ONLINE');
  });
});
