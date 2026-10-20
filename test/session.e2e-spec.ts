import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';

interface Body {
  success: boolean;
  data: Record<string, unknown>;
  code?: string;
}

// 실제 테스트 DB에 요청을 보내 REST 계층(검증, 응답 형식, 저장)을 확인한다.
describe('Sessions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
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

  function postEnd(sessionId: string, userId: string) {
    return http().post(`/sessions/${sessionId}/end`).set('X-User-Id', userId);
  }

  function end(sessionId: string, userId: string) {
    return postEnd(sessionId, userId).expect(201);
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

  describe('POST /sessions/{id}/end', () => {
    async function sessionRow(sessionId: string) {
      const [row] = await dataSource.query<
        { status: string; ended_at: Date | null }[]
      >('SELECT status, ended_at FROM sessions WHERE id = ?', [sessionId]);
      return row;
    }

    it('JOIN 세션을 종료하면 201과 SESSION_ENDED 이벤트를 돌려주고 END가 된다', async () => {
      const sessionId = await createWithTwo();
      const res = await end(sessionId, 'user-b');
      expect((res.body as Body).data).toEqual({
        eventId: expect.any(Number) as number,
        sessionId,
        seq: 4,
        type: 'SESSION_ENDED',
        actorId: 'user-b',
        clientEventId: null,
        payload: {},
        clientSentAt: null,
        receivedAt: expect.stringMatching(/^\d{4}-.+\.\d{3}Z$/) as string,
      });

      const row = await sessionRow(sessionId);
      expect(row.status).toBe('END');
      expect(row.ended_at).not.toBeNull();
    });

    it('LEAVE 세션은 남은 참여자가 종료할 수 있다', async () => {
      const sessionId = await createWithTwo();
      await leave(sessionId, 'user-b');
      await end(sessionId, 'user-a');
      expect((await sessionRow(sessionId)).status).toBe('END');
    });

    it('이미 END면 200으로 기존 이벤트를 돌려주고 새로 저장하지 않는다', async () => {
      const sessionId = await createWithTwo();
      const first = await end(sessionId, 'user-a');

      // 다른 참여자가 다시 종료해도 처음 이벤트다.
      const again = await postEnd(sessionId, 'user-b').expect(200);
      expect((again.body as Body).data).toEqual((first.body as Body).data);
      expect(await countEvents(sessionId)).toBe(4);
    });

    it('나간 사용자와 참여자가 아닌 사용자는 403 NOT_PARTICIPANT', async () => {
      const sessionId = await createWithTwo();
      await leave(sessionId, 'user-b');

      for (const userId of ['user-b', 'user-c']) {
        const res = await postEnd(sessionId, userId).expect(403);
        expect((res.body as Body).code).toBe('NOT_PARTICIPANT');
      }
      // 종료된 뒤에도 같다.
      await end(sessionId, 'user-a');
      const res = await postEnd(sessionId, 'user-b').expect(403);
      expect((res.body as Body).code).toBe('NOT_PARTICIPANT');
    });

    it('없는 세션은 404 SESSION_NOT_FOUND', async () => {
      const res = await postEnd(
        '0192a3b4-0000-7000-8000-000000000000',
        'user-a',
      ).expect(404);
      expect((res.body as Body).code).toBe('SESSION_NOT_FOUND');
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const sessionId = await createSession();
      const res = await http().post(`/sessions/${sessionId}/end`).expect(401);
      expect((res.body as Body).code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /sessions', () => {
    interface ListBody {
      success: boolean;
      code?: string;
      data: {
        items: { id: string; status: string; participants: unknown[] }[];
        nextCursor: string | null;
      };
    }

    function list(query: Record<string, string | number> = {}) {
      return http().get('/sessions').set('X-User-Id', 'user-a').query(query);
    }

    function setCreatedAt(sessionId: string, at: string) {
      return dataSource.query(
        'UPDATE sessions SET created_at = ? WHERE id = ?',
        [new Date(at), sessionId],
      );
    }

    async function ids(query: Record<string, string | number> = {}) {
      const res = await list(query).expect(200);
      return (res.body as ListBody).data.items.map((s) => s.id);
    }

    it('createdAt DESC, id DESC 순서로 커서를 따라가면 빠짐과 중복 없이 모두 나온다', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        created.push(await createSession());
      }
      // 세 세션의 생성 시각을 같게 만들어 id로 순서가 갈리는지 본다.
      for (const id of created.slice(1, 4)) {
        await setCreatedAt(id, '2026-10-19T06:00:00.500Z');
      }
      await setCreatedAt(created[0], '2026-10-19T06:00:00.000Z');
      await setCreatedAt(created[4], '2026-10-19T06:00:01.000Z');
      const expected = [
        created[4],
        ...created.slice(1, 4).sort().reverse(),
        created[0],
      ];

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await list({ limit: 2, ...(cursor && { cursor }) }).expect(
          200,
        );
        const { data } = res.body as ListBody;
        seen.push(...data.items.map((s) => s.id));
        cursor = data.nextCursor;
        pages++;
      } while (cursor);

      expect(seen).toEqual(expected);
      expect(pages).toBe(3);
    });

    it('항목은 세션 형식이고 참여자를 포함한다', async () => {
      const sessionId = await createWithTwo();
      const res = await list().expect(200);
      const { data } = res.body as ListBody;
      expect(data.nextCursor).toBeNull();
      expect(data.items).toHaveLength(1);
      expect(data.items[0]).toMatchObject({
        id: sessionId,
        title: '상담 문의',
        status: 'JOIN',
        createdBy: 'user-a',
        lastSeq: 3,
        endedAt: null,
        participants: [
          { userId: 'user-a', leftAt: null, presence: 'OFFLINE' },
          { userId: 'user-b', leftAt: null, presence: 'OFFLINE' },
        ],
      });
    });

    it('status로 거르고, 쉼표로 여러 개를 줄 수 있다', async () => {
      const joined = await createWithTwo();
      const left = await createWithTwo();
      await leave(left, 'user-b');
      const ended = await createWithTwo();
      await end(ended, 'user-a');

      expect(await ids({ status: 'LEAVE' })).toEqual([left]);
      expect((await ids({ status: 'JOIN,END' })).sort()).toEqual(
        [joined, ended].sort(),
      );
    });

    it('participantId는 그 사용자가 참여한 세션만, 나간 세션도 포함한다', async () => {
      const withB = await createWithTwo();
      const leftB = await createWithTwo();
      await leave(leftB, 'user-b');
      await createSession('user-c');

      expect((await ids({ participantId: 'user-b' })).sort()).toEqual(
        [withB, leftB].sort(),
      );
      expect(await ids({ participantId: 'user-z' })).toEqual([]);
    });

    it('from은 포함, to는 미포함이다', async () => {
      const before = await createSession();
      const atFrom = await createSession();
      const atTo = await createSession();
      await setCreatedAt(before, '2026-10-18T23:59:59.999Z');
      await setCreatedAt(atFrom, '2026-10-19T00:00:00.000Z');
      await setCreatedAt(atTo, '2026-10-20T00:00:00.000Z');

      expect(
        await ids({
          from: '2026-10-19T00:00:00.000Z',
          to: '2026-10-20T00:00:00.000Z',
        }),
      ).toEqual([atFrom]);
    });

    it('필터를 함께 쓸 수 있다', async () => {
      const target = await createWithTwo();
      const other = await createWithTwo();
      await end(other, 'user-a');
      expect(await ids({ status: 'JOIN', participantId: 'user-b' })).toEqual([
        target,
      ]);
    });

    it.each([
      ['limit 0', { limit: 0 }],
      ['limit 101', { limit: 101 }],
      ['정수가 아닌 limit', { limit: 'abc' }],
      ['없는 status', { status: 'JOIN,FOO' }],
      ['빈 status', { status: '' }],
      ['ISO-8601이 아닌 from', { from: '2026/10/19' }],
      ['ISO-8601이 아닌 to', { to: 'tomorrow' }],
      ['잘못된 cursor', { cursor: 'abc' }],
      ['정의되지 않은 파라미터', { sort: 'asc' }],
    ])('%s은 400 VALIDATION_ERROR', async (_name, query) => {
      const res = await list(query).expect(400);
      expect((res.body as ListBody).code).toBe('VALIDATION_ERROR');
    });

    it('limit 100은 허용한다', async () => {
      await list({ limit: 100 }).expect(200);
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const res = await http().get('/sessions').expect(401);
      expect((res.body as ListBody).code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /sessions/{id}/timeline', () => {
    interface TimelineBody {
      success: boolean;
      code?: string;
      data: {
        sessionId: string;
        at: string;
        seq: number;
        state: {
          status: string;
          participants: { userId: string; leftAt: string | null }[];
          messageCount: number;
          lastMessage: { seq: number; content: string } | null;
        };
      };
    }

    function timeline(sessionId: string, at: string) {
      return http()
        .get(`/sessions/${sessionId}/timeline`)
        .set('X-User-Id', 'user-a')
        .query({ at });
    }

    async function receivedAtOf(sessionId: string, seq: number) {
      const [row] = await dataSource.query<{ received_at: Date }[]>(
        'SELECT received_at FROM messages WHERE session_id = ? AND seq = ?',
        [sessionId, seq],
      );
      return row.received_at.toISOString();
    }

    it('각 이벤트 시각의 상태를 복원한다', async () => {
      const sessionId = await createWithTwo(); // seq 1~3
      await sendMessage(sessionId, 'user-a', '첫 메시지').expect(201); // 4
      await sendMessage(sessionId, 'user-b', '두 번째').expect(201); // 5
      await leave(sessionId, 'user-b'); // 6
      await end(sessionId, 'user-a'); // 7

      const expected: Record<
        number,
        {
          status: string;
          users: string[];
          count: number;
          last: string | null;
          left: boolean;
        }
      > = {
        // seq 2는 생성자만 참여한 상태다.
        2: {
          status: 'JOIN',
          users: ['user-a'],
          count: 0,
          last: null,
          left: false,
        },
        5: {
          status: 'JOIN',
          users: ['user-a', 'user-b'],
          count: 2,
          last: '두 번째',
          left: false,
        },
        6: {
          status: 'LEAVE',
          users: ['user-a', 'user-b'],
          count: 2,
          last: '두 번째',
          left: true,
        },
        7: {
          status: 'END',
          users: ['user-a', 'user-b'],
          count: 2,
          last: '두 번째',
          left: true,
        },
      };
      for (const [seq, want] of Object.entries(expected)) {
        const at = await receivedAtOf(sessionId, Number(seq));
        const res = await timeline(sessionId, at).expect(200);
        const { data } = res.body as TimelineBody;
        // 같은 밀리초에 저장된 이벤트가 있으면 그중 가장 큰 seq가 기준이다.
        expect(data.seq).toBeGreaterThanOrEqual(Number(seq));
        if (data.seq !== Number(seq)) {
          continue;
        }
        expect(data).toMatchObject({ sessionId, at, seq: Number(seq) });
        expect(data.state.status).toBe(want.status);
        expect(data.state.messageCount).toBe(want.count);
        expect(data.state.lastMessage?.content ?? null).toBe(want.last);
        expect(data.state.participants.map((p) => p.userId)).toEqual(
          want.users,
        );
        const userB = data.state.participants.find(
          (p) => p.userId === 'user-b',
        );
        expect((userB?.leftAt ?? null) !== null).toBe(want.left);
      }
    });

    it('마지막 이벤트 이후 시각은 현재 상태, 같은 at은 같은 결과다', async () => {
      const sessionId = await createWithTwo();
      await sendMessage(sessionId, 'user-a', '안녕').expect(201);
      const at = '2999-01-01T00:00:00.000Z';

      const first = await timeline(sessionId, at).expect(200);
      const again = await timeline(sessionId, at).expect(200);
      expect((again.body as TimelineBody).data).toEqual(
        (first.body as TimelineBody).data,
      );
      expect((first.body as TimelineBody).data).toMatchObject({
        at,
        seq: 4,
        state: { status: 'JOIN', messageCount: 1 },
      });
    });

    it('시간대가 붙은 at은 UTC로 바꿔 돌려준다', async () => {
      const sessionId = await createSession();
      const res = await timeline(
        sessionId,
        '2999-01-01T09:00:00.000+09:00',
      ).expect(200);
      expect((res.body as TimelineBody).data.at).toBe(
        '2999-01-01T00:00:00.000Z',
      );
    });

    it('세션 생성 이전 시각과 없는 세션은 404 SESSION_NOT_FOUND', async () => {
      const sessionId = await createSession();
      const before = await timeline(
        sessionId,
        '2000-01-01T00:00:00.000Z',
      ).expect(404);
      expect((before.body as TimelineBody).code).toBe('SESSION_NOT_FOUND');

      const missing = await timeline(
        '0192a3b4-0000-7000-8000-000000000000',
        '2999-01-01T00:00:00.000Z',
      ).expect(404);
      expect((missing.body as TimelineBody).code).toBe('SESSION_NOT_FOUND');
    });

    it.each([
      ['at 없음', {}],
      ['ISO-8601이 아닌 at', { at: '2026/10/19' }],
      ['정의되지 않은 파라미터', { at: '2999-01-01T00:00:00.000Z', seq: 1 }],
    ])('%s은 400 VALIDATION_ERROR', async (_name, query) => {
      const sessionId = await createSession();
      const res = await http()
        .get(`/sessions/${sessionId}/timeline`)
        .set('X-User-Id', 'user-a')
        .query(query)
        .expect(400);
      expect((res.body as TimelineBody).code).toBe('VALIDATION_ERROR');
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const sessionId = await createSession();
      const res = await http()
        .get(`/sessions/${sessionId}/timeline`)
        .query({ at: '2999-01-01T00:00:00.000Z' })
        .expect(401);
      expect((res.body as TimelineBody).code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /sessions/{id}/events', () => {
    interface EventsBody {
      success: boolean;
      code?: string;
      data: { items: { seq: number; type: string }[]; hasMore: boolean };
    }

    function events(
      sessionId: string,
      query: Record<string, string | number> = {},
    ) {
      return http()
        .get(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-a')
        .query(query);
    }

    it('afterSeq 다음부터 seq 오름차순으로 모든 타입의 이벤트를 돌려준다', async () => {
      const sessionId = await createWithTwo(); // 1~3
      const sent = await sendMessage(sessionId, 'user-a', '안녕').expect(201); // 4
      await leave(sessionId, 'user-b'); // 5

      const all = await events(sessionId).expect(200);
      expect((all.body as EventsBody).data).toEqual({
        items: [
          expect.objectContaining({ seq: 1, type: 'SESSION_CREATED' }),
          expect.objectContaining({ seq: 2, type: 'PARTICIPANT_JOINED' }),
          expect.objectContaining({ seq: 3, type: 'PARTICIPANT_JOINED' }),
          (sent.body as Body).data,
          expect.objectContaining({ seq: 5, type: 'PARTICIPANT_LEFT' }),
        ],
        hasMore: false,
      });

      const after = await events(sessionId, { afterSeq: 3 }).expect(200);
      expect((after.body as EventsBody).data.items.map((e) => e.seq)).toEqual([
        4, 5,
      ]);
    });

    it('limit으로 나눠 받고, hasMore가 false가 될 때까지 이어 받으면 빠짐이 없다', async () => {
      const sessionId = await createWithTwo();
      for (let i = 0; i < 4; i++) {
        await sendMessage(sessionId, 'user-a', `m${i}`).expect(201);
      }

      const seqs: number[] = [];
      let afterSeq = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await events(sessionId, { afterSeq, limit: 3 }).expect(200);
        const { data } = res.body as EventsBody;
        seqs.push(...data.items.map((e) => e.seq));
        afterSeq = seqs.at(-1)!;
        hasMore = data.hasMore;
      }
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('마지막 seq 이후를 조회하면 빈 목록이다', async () => {
      const sessionId = await createSession();
      const res = await events(sessionId, { afterSeq: 2 }).expect(200);
      expect((res.body as EventsBody).data).toEqual({
        items: [],
        hasMore: false,
      });
    });

    it('나간 참여자는 조회할 수 있고, 참여 기록이 없으면 403 NOT_PARTICIPANT', async () => {
      const sessionId = await createWithTwo();
      await leave(sessionId, 'user-b');
      await http()
        .get(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-b')
        .expect(200);

      const res = await http()
        .get(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-c')
        .expect(403);
      expect((res.body as EventsBody).code).toBe('NOT_PARTICIPANT');
    });

    it('없는 세션은 404 SESSION_NOT_FOUND', async () => {
      const res = await events('0192a3b4-0000-7000-8000-000000000000').expect(
        404,
      );
      expect((res.body as EventsBody).code).toBe('SESSION_NOT_FOUND');
    });

    it.each([
      ['음수 afterSeq', { afterSeq: -1 }],
      ['정수가 아닌 afterSeq', { afterSeq: 'abc' }],
      ['limit 0', { limit: 0 }],
      ['limit 501', { limit: 501 }],
      ['정의되지 않은 파라미터', { beforeSeq: 1 }],
    ])('%s은 400 VALIDATION_ERROR', async (_name, query) => {
      const sessionId = await createSession();
      const res = await events(sessionId, query).expect(400);
      expect((res.body as EventsBody).code).toBe('VALIDATION_ERROR');
    });

    it('X-User-Id가 없으면 401 UNAUTHORIZED', async () => {
      const sessionId = await createSession();
      const res = await http().get(`/sessions/${sessionId}/events`).expect(401);
      expect((res.body as EventsBody).code).toBe('UNAUTHORIZED');
    });
  });
});
