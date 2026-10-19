import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/typeorm.config';
import { Message } from '../src/event/entities/message.entity';
import { EventType } from '../src/event/event-type';
import { EventRepository } from '../src/event/event.repository';
import { EventService } from '../src/event/event.service';
import { Participant } from '../src/session/entities/participant.entity';
import { Session } from '../src/session/entities/session.entity';
import { replay, SessionState } from '../src/session/session.reducer';

// 실제 MariaDB(테스트 DB)에서 잠금, UNIQUE, 엔티티 매핑을 확인한다.
describe('EventService (MariaDB)', () => {
  let dataSource: DataSource;
  let service: EventService;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...buildDataSourceOptions(process.env),
      // 동시 요청 테스트를 위해 커넥션을 넉넉히 둔다.
      poolSize: 30,
    });
    await dataSource.initialize();
    service = new EventService(dataSource, new EventRepository());
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM messages');
    await dataSource.query('DELETE FROM participants');
    await dataSource.query('DELETE FROM sessions');
  });

  afterAll(() => dataSource.destroy());

  async function createWithTwo(): Promise<string> {
    const [created] = await service.createSession({
      title: '상담 문의',
      actorId: 'user-a',
    });
    await service.append(created.sessionId, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: 'user-b',
    });
    return created.sessionId;
  }

  function sendMessage(
    actorId: string,
    content: string,
    clientEventId = uuid(),
  ) {
    return {
      type: EventType.MESSAGE_CREATED,
      actorId,
      clientEventId,
      payload: { content },
    } as const;
  }

  let counter = 0;
  function uuid(): string {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  }

  // 저장된 이벤트를 seq 순으로 처음부터 적용한 상태
  async function replayFromLog(sessionId: string): Promise<SessionState> {
    const events = await dataSource
      .getRepository(Message)
      .find({ where: { sessionId }, order: { seq: 'ASC' } });
    return replay(
      events.map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })),
    );
  }

  it('동시에 들어온 메시지에 빈틈과 중복 없이 seq를 부여한다', async () => {
    const sessionId = await createWithTwo();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.append(
          sessionId,
          sendMessage(i % 2 ? 'user-a' : 'user-b', `메시지 ${i}`),
        ),
      ),
    );

    const seqs = results.map((r) => r.event.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 4));
    const session = await dataSource
      .getRepository(Session)
      .findOneByOrFail({ id: sessionId });
    expect(session.lastSeq).toBe(23);
    expect(session.messageCount).toBe(20);
    expect(session.lastMessageSeq).toBe(23);
  });

  it('같은 clientEventId가 동시에 와도 한 번만 저장한다', async () => {
    const sessionId = await createWithTwo();
    const request = sendMessage('user-a', '한 번만', uuid());

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.append(sessionId, request)),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.event.eventId)).size).toBe(1);
    expect(
      await dataSource
        .getRepository(Message)
        .countBy({ sessionId, type: EventType.MESSAGE_CREATED }),
    ).toBe(1);
  });

  it('저장한 이벤트를 공통 형식으로 다시 읽을 수 있다', async () => {
    const sessionId = await createWithTwo();
    const clientSentAt = new Date('2026-10-19T06:20:00.100Z');
    const { event } = await service.append(sessionId, {
      ...sendMessage('user-a', '안녕하세요 😀'),
      clientSentAt,
    });

    const duplicate = await service.append(sessionId, {
      ...sendMessage('user-a', '다른 내용', event.clientEventId!),
    });

    // 재조회한 값(JSON, BIGINT, DATETIME(3), utf8mb4)이 처음 응답과 같다.
    expect(duplicate).toEqual({ created: false, event });
    expect(event.payload).toEqual({ content: '안녕하세요 😀' });
    expect(event.clientSentAt).toBe('2026-10-19T06:20:00.100Z');
    expect(typeof event.eventId).toBe('number');
  });

  it('여러 종류의 이벤트를 거친 뒤 프로젝션이 이벤트 재적용 결과와 같다', async () => {
    const sessionId = await createWithTwo();
    await service.append(sessionId, {
      type: EventType.PRESENCE_ONLINE,
      actorId: 'user-a',
      payload: { socketId: 's1' },
    });
    await service.append(sessionId, sendMessage('user-a', '첫 메시지'));
    await service.append(sessionId, sendMessage('user-b', '답장'));
    await service.append(sessionId, {
      type: EventType.PARTICIPANT_LEFT,
      actorId: 'user-b',
      clientEventId: uuid(),
    });
    await service.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: 'user-a',
    });

    const expected = await replayFromLog(sessionId);
    const session = await dataSource
      .getRepository(Session)
      .findOneByOrFail({ id: sessionId });
    const participants = await dataSource.getRepository(Participant).find({
      where: { sessionId },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });

    expect(expected.status).toBe('END');
    expect(session.status).toBe(expected.status);
    expect(session.lastSeq).toBe(8);
    expect(session.participantCount).toBe(expected.participants.length);
    expect(session.messageCount).toBe(expected.messageCount);
    expect(session.lastMessageSeq).toBe(expected.lastMessage?.seq);
    expect(session.endedAt).not.toBeNull();
    expect(
      participants.map((p) => ({
        userId: p.userId,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt?.toISOString() ?? null,
        presence: p.presence,
      })),
    ).toEqual(expected.participants);
  });

  it('멱등 요청(재참여, 재종료)은 새 이벤트를 만들지 않는다', async () => {
    const sessionId = await createWithTwo();
    const rejoin = await service.append(sessionId, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: 'user-b',
    });
    const ended = await service.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: 'user-a',
    });
    const endedAgain = await service.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: 'user-b',
    });

    expect(rejoin).toEqual(
      expect.objectContaining({
        created: false,
        event: expect.objectContaining({ seq: 3 }) as unknown,
      }),
    );
    expect(endedAgain).toEqual({ created: false, event: ended.event });
    expect(await dataSource.getRepository(Message).countBy({ sessionId })).toBe(
      4,
    );
  });

  it('상태 검증에 실패하면 트랜잭션이 아무것도 남기지 않는다', async () => {
    const sessionId = await createWithTwo();

    await expect(
      service.append(sessionId, {
        type: EventType.PARTICIPANT_JOINED,
        actorId: 'user-c',
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'SESSION_FULL' }));

    const session = await dataSource
      .getRepository(Session)
      .findOneByOrFail({ id: sessionId });
    expect(session.lastSeq).toBe(3);
    expect(await dataSource.getRepository(Message).countBy({ sessionId })).toBe(
      3,
    );
  });
});
