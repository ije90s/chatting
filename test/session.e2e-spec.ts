import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { EventType } from '../src/event/event-type';
import { EventService } from '../src/event/event.service';

interface Body {
  success: boolean;
  data: Record<string, unknown>;
  code?: string;
}

// 실제 테스트 DB에 요청을 보내 REST 계층(검증, 응답 형식, 저장)을 확인한다.
describe('Sessions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let eventService: EventService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    eventService = app.get(EventService);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM snapshots');
    await dataSource.query('DELETE FROM messages');
    await dataSource.query('DELETE FROM participants');
    await dataSource.query('DELETE FROM sessions');
  });

  afterAll(() => app.close());

  function http() {
    return request(app.getHttpServer());
  }

  describe('POST /sessions', () => {
    it('세션을 만들고 생성자를 자동 참여시킨다', async () => {
      const res = await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '상담 문의' })
        .expect(201);
      const body = res.body as Body;

      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ) as string,
        title: '상담 문의',
        status: 'JOIN',
        createdBy: 'user-a',
        participants: [
          {
            userId: 'user-a',
            joinedAt: body.data.createdAt,
            leftAt: null,
            presence: 'OFFLINE',
          },
        ],
        lastSeq: 2,
        createdAt: expect.stringMatching(/^\d{4}-.+\.\d{3}Z$/) as string,
        endedAt: null,
      });

      const events = await dataSource.query<{ seq: string; type: string }[]>(
        'SELECT seq, type FROM messages WHERE session_id = ? ORDER BY seq',
        [body.data.id],
      );
      expect(events.map((e) => [Number(e.seq), e.type])).toEqual([
        [1, 'SESSION_CREATED'],
        [2, 'PARTICIPANT_JOINED'],
      ]);
    });

    it('제목의 앞뒤 공백을 제거해 저장한다', async () => {
      const res = await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '  상담  문의 ' })
        .expect(201);
      expect((res.body as Body).data.title).toBe('상담  문의');
    });

    it('텍스트 기호(©, ™, ❤)는 허용한다', async () => {
      await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '상담© 문의™ ❤' })
        .expect(201);
    });

    it('제목은 100자까지 허용한다', async () => {
      await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '가'.repeat(100) })
        .expect(201);
    });

    it.each([
      ['제목 없음', {}],
      ['빈 제목', { title: '' }],
      ['공백만 있는 제목', { title: ' \t\n ' }],
      ['이모지 제목', { title: '상담 😀' }],
      ['이모지 표시 선택자', { title: '상담 ❤️' }],
      ['국기 이모지', { title: '상담 🇰🇷' }],
      ['키캡 이모지', { title: '상담 1️⃣' }],
      ['101자 제목', { title: '가'.repeat(101) }],
      ['공백 제거 후 101자', { title: ` ${'가'.repeat(101)} ` }],
      ['문자열이 아닌 제목', { title: 1 }],
      ['정의되지 않은 필드', { title: '상담', extra: true }],
    ])('%s은 400 VALIDATION_ERROR이고 저장하지 않는다', async (_name, send) => {
      const res = await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send(send)
        .expect(400);
      expect((res.body as Body).code).toBe('VALIDATION_ERROR');

      const [{ count }] = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*) AS count FROM sessions',
      );
      expect(Number(count)).toBe(0);
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const res = await http()
        .post('/sessions')
        .send({ title: '상담 문의' })
        .expect(401);
      expect((res.body as Body).code).toBe('UNAUTHORIZED');
    });
  });

  async function createSession(userId = 'user-a'): Promise<string> {
    const res = await http()
      .post('/sessions')
      .set('X-User-Id', userId)
      .send({ title: '상담 문의' })
      .expect(201);
    return (res.body as Body).data.id as string;
  }

  function join(sessionId: string, userId: string) {
    return http().post(`/sessions/${sessionId}/join`).set('X-User-Id', userId);
  }

  function postEvent(
    sessionId: string,
    userId: string,
    send: Record<string, unknown>,
  ) {
    return http()
      .post(`/sessions/${sessionId}/events`)
      .set('X-User-Id', userId)
      .send(send);
  }

  function sendMessage(
    sessionId: string,
    userId: string,
    content: string,
    clientEventId = uuidv4(),
  ) {
    return postEvent(sessionId, userId, {
      clientEventId,
      type: 'MESSAGE_CREATED',
      payload: { content },
    });
  }

  function leave(sessionId: string, userId: string) {
    return postEvent(sessionId, userId, {
      clientEventId: uuidv4(),
      type: 'PARTICIPANT_LEFT',
    }).expect(201);
  }

  // end 엔드포인트가 생기기 전까지는 EventService로 종료한다.
  function end(sessionId: string, userId: string) {
    return eventService.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: userId,
    });
  }

  describe('POST /sessions/{id}/join', () => {
    it('새로 참여하면 201과 PARTICIPANT_JOINED 이벤트를 돌려준다', async () => {
      const sessionId = await createSession();
      const res = await join(sessionId, 'user-b').expect(201);
      const body = res.body as Body;

      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        eventId: expect.any(Number) as number,
        sessionId,
        seq: 3,
        type: 'PARTICIPANT_JOINED',
        actorId: 'user-b',
        clientEventId: null,
        payload: {},
        clientSentAt: null,
        receivedAt: expect.stringMatching(/^\d{4}-.+\.\d{3}Z$/) as string,
      });

      const [session] = await dataSource.query<{ participant_count: number }[]>(
        'SELECT participant_count FROM sessions WHERE id = ?',
        [sessionId],
      );
      expect(Number(session.participant_count)).toBe(2);
    });

    it('이미 참여 중이면 200으로 기존 이벤트를 돌려주고 새로 저장하지 않는다', async () => {
      const sessionId = await createSession();
      const first = await join(sessionId, 'user-b').expect(201);
      const again = await join(sessionId, 'user-b').expect(200);
      expect((again.body as Body).data).toEqual((first.body as Body).data);

      // 생성자는 생성 시 자동 참여(seq 2)했다.
      const creator = await join(sessionId, 'user-a').expect(200);
      expect((creator.body as Body).data.seq).toBe(2);

      const [{ count }] = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*) AS count FROM messages WHERE session_id = ?',
        [sessionId],
      );
      expect(Number(count)).toBe(3);
    });

    it('세 번째 사용자는 409 SESSION_FULL', async () => {
      const sessionId = await createSession();
      await join(sessionId, 'user-b').expect(201);
      const res = await join(sessionId, 'user-c').expect(409);
      expect((res.body as Body).code).toBe('SESSION_FULL');
    });

    it('나간 사용자의 재참여는 409 ALREADY_LEFT', async () => {
      const sessionId = await createSession();
      await join(sessionId, 'user-b').expect(201);
      await leave(sessionId, 'user-b');
      const res = await join(sessionId, 'user-b').expect(409);
      expect((res.body as Body).code).toBe('ALREADY_LEFT');
    });

    it.each([
      ['LEAVE', leave],
      ['END', end],
    ])(
      '%s 세션에 새 사용자가 참여하면 409 INVALID_SESSION_STATUS',
      async (_status, change) => {
        const sessionId = await createSession();
        await change(sessionId, 'user-a');
        const res = await join(sessionId, 'user-b').expect(409);
        expect((res.body as Body).code).toBe('INVALID_SESSION_STATUS');
      },
    );

    it('없는 세션은 404 SESSION_NOT_FOUND', async () => {
      const res = await join(
        '0192a3b4-0000-7000-8000-000000000000',
        'user-b',
      ).expect(404);
      expect((res.body as Body).code).toBe('SESSION_NOT_FOUND');
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const sessionId = await createSession();
      const res = await http().post(`/sessions/${sessionId}/join`).expect(401);
      expect((res.body as Body).code).toBe('UNAUTHORIZED');
    });
  });

  async function countEvents(sessionId: string): Promise<number> {
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*) AS count FROM messages WHERE session_id = ?',
      [sessionId],
    );
    return Number(count);
  }

  async function createWithTwo(): Promise<string> {
    const sessionId = await createSession();
    await join(sessionId, 'user-b').expect(201);
    return sessionId;
  }

  describe('POST /sessions/{id}/events', () => {
    it('메시지를 저장하면 201과 이벤트를 돌려준다', async () => {
      const sessionId = await createWithTwo();
      const clientEventId = uuidv4();
      const res = await postEvent(sessionId, 'user-b', {
        clientEventId,
        type: 'MESSAGE_CREATED',
        payload: { content: '안녕하세요' },
        clientSentAt: '2026-10-19T06:20:00.100Z',
      }).expect(201);

      expect((res.body as Body).data).toEqual({
        eventId: expect.any(Number) as number,
        sessionId,
        seq: 4,
        type: 'MESSAGE_CREATED',
        actorId: 'user-b',
        clientEventId,
        payload: { content: '안녕하세요' },
        clientSentAt: '2026-10-19T06:20:00.100Z',
        receivedAt: expect.stringMatching(/^\d{4}-.+\.\d{3}Z$/) as string,
      });
    });

    it('메시지는 5000자까지 허용하고 앞뒤 공백을 포함해 그대로 저장한다', async () => {
      const sessionId = await createWithTwo();
      const long = await sendMessage(
        sessionId,
        'user-a',
        '가'.repeat(5000),
      ).expect(201);
      expect(
        ((long.body as Body).data.payload as { content: string }).content,
      ).toHaveLength(5000);

      // 이모지는 UTF-16으로 2자지만 1자로 센다.
      await sendMessage(sessionId, 'user-a', '😀'.repeat(5000)).expect(201);

      const spaced = await sendMessage(sessionId, 'user-a', '  안녕 \n').expect(
        201,
      );
      expect((spaced.body as Body).data.payload).toEqual({
        content: '  안녕 \n',
      });
    });

    it('같은 clientEventId는 200으로 기존 이벤트를 돌려주고 새로 저장하지 않는다', async () => {
      const sessionId = await createWithTwo();
      const clientEventId = uuidv4();
      const first = await sendMessage(
        sessionId,
        'user-a',
        '안녕',
        clientEventId,
      ).expect(201);
      // 재전송 본문이 달라도 키가 같으면 처음 저장한 이벤트다.
      const again = await sendMessage(
        sessionId,
        'user-a',
        '안녕하세요',
        clientEventId,
      ).expect(200);

      expect((again.body as Body).data).toEqual((first.body as Body).data);
      expect(await countEvents(sessionId)).toBe(4);
    });

    it('세션이 그 뒤 END가 됐어도 저장된 키는 200으로 기존 이벤트를 돌려준다', async () => {
      const sessionId = await createWithTwo();
      const clientEventId = uuidv4();
      const first = await sendMessage(
        sessionId,
        'user-a',
        '안녕',
        clientEventId,
      ).expect(201);
      await end(sessionId, 'user-a');

      const again = await sendMessage(
        sessionId,
        'user-a',
        '안녕',
        clientEventId,
      ).expect(200);
      expect((again.body as Body).data).toEqual((first.body as Body).data);

      // 저장된 적 없는 키는 상태를 검증한다.
      const res = await sendMessage(sessionId, 'user-a', '안녕').expect(409);
      expect((res.body as Body).code).toBe('INVALID_SESSION_STATUS');
    });

    it('나가면 201, 세션은 LEAVE가 되고 나간 시각이 남는다', async () => {
      const sessionId = await createWithTwo();
      const res = await leave(sessionId, 'user-b');
      expect((res.body as Body).data).toMatchObject({
        seq: 4,
        type: 'PARTICIPANT_LEFT',
        actorId: 'user-b',
        payload: {},
      });

      const [session] = await dataSource.query<{ status: string }[]>(
        'SELECT status FROM sessions WHERE id = ?',
        [sessionId],
      );
      expect(session.status).toBe('LEAVE');
      const [participant] = await dataSource.query<{ left_at: Date | null }[]>(
        "SELECT left_at FROM participants WHERE session_id = ? AND user_id = 'user-b'",
        [sessionId],
      );
      expect(participant.left_at).not.toBeNull();
    });

    it('이미 나간 사용자가 새 키로 다시 나가면 200으로 기존 이벤트를 돌려준다', async () => {
      const sessionId = await createWithTwo();
      const first = await leave(sessionId, 'user-b');
      const again = await postEvent(sessionId, 'user-b', {
        clientEventId: uuidv4(),
        type: 'PARTICIPANT_LEFT',
        payload: {},
      }).expect(200);

      expect((again.body as Body).data).toEqual((first.body as Body).data);
      expect(await countEvents(sessionId)).toBe(4);
    });

    it('나간 사용자의 메시지는 409 ALREADY_LEFT, 남은 사용자의 메시지는 409 INVALID_SESSION_STATUS', async () => {
      const sessionId = await createWithTwo();
      await leave(sessionId, 'user-b');

      const left = await sendMessage(sessionId, 'user-b', '안녕').expect(409);
      expect((left.body as Body).code).toBe('ALREADY_LEFT');
      const remaining = await sendMessage(sessionId, 'user-a', '안녕').expect(
        409,
      );
      expect((remaining.body as Body).code).toBe('INVALID_SESSION_STATUS');
    });

    it('참여자가 아니면 메시지와 나가기 모두 403 NOT_PARTICIPANT', async () => {
      const sessionId = await createSession();
      const message = await sendMessage(sessionId, 'user-c', '안녕').expect(
        403,
      );
      expect((message.body as Body).code).toBe('NOT_PARTICIPANT');
      const left = await postEvent(sessionId, 'user-c', {
        clientEventId: uuidv4(),
        type: 'PARTICIPANT_LEFT',
      }).expect(403);
      expect((left.body as Body).code).toBe('NOT_PARTICIPANT');
    });

    it.each([
      [
        'clientEventId 없음',
        { type: 'MESSAGE_CREATED', payload: { content: 'a' } },
      ],
      [
        'UUID가 아닌 clientEventId',
        {
          clientEventId: 'abc',
          type: 'MESSAGE_CREATED',
          payload: { content: 'a' },
        },
      ],
      ['type 없음', { clientEventId: uuidv4(), payload: { content: 'a' } }],
      [
        '전용 엔드포인트가 있는 type',
        { clientEventId: uuidv4(), type: 'PARTICIPANT_JOINED' },
      ],
      [
        '서버만 만드는 type',
        { clientEventId: uuidv4(), type: 'PRESENCE_ONLINE' },
      ],
      [
        '메시지 payload 없음',
        { clientEventId: uuidv4(), type: 'MESSAGE_CREATED' },
      ],
      [
        '빈 content',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: '' },
        },
      ],
      [
        '공백만 있는 content',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: ' \t\n ' },
        },
      ],
      [
        '5001자 content',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: '가'.repeat(5001) },
        },
      ],
      [
        '문자열이 아닌 content',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: 1 },
        },
      ],
      [
        'payload에 정의되지 않은 필드',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: 'a', extra: true },
        },
      ],
      [
        '나가기 payload가 비어 있지 않음',
        {
          clientEventId: uuidv4(),
          type: 'PARTICIPANT_LEFT',
          payload: { content: 'a' },
        },
      ],
      [
        'ISO-8601이 아닌 clientSentAt',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: 'a' },
          clientSentAt: '2026/10/19',
        },
      ],
      [
        '정의되지 않은 필드',
        {
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: 'a' },
          seq: 1,
        },
      ],
    ])('%s은 400 VALIDATION_ERROR이고 저장하지 않는다', async (_name, send) => {
      const sessionId = await createWithTwo();
      const res = await postEvent(sessionId, 'user-a', send).expect(400);
      expect((res.body as Body).code).toBe('VALIDATION_ERROR');
      expect(await countEvents(sessionId)).toBe(3);
    });

    it('없는 세션은 404 SESSION_NOT_FOUND', async () => {
      const res = await sendMessage(
        '0192a3b4-0000-7000-8000-000000000000',
        'user-a',
        '안녕',
      ).expect(404);
      expect((res.body as Body).code).toBe('SESSION_NOT_FOUND');
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const sessionId = await createSession();
      const res = await http()
        .post(`/sessions/${sessionId}/events`)
        .send({
          clientEventId: uuidv4(),
          type: 'MESSAGE_CREATED',
          payload: { content: '안녕' },
        })
        .expect(401);
      expect((res.body as Body).code).toBe('UNAUTHORIZED');
    });
  });
});
