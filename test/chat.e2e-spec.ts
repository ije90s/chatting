import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/realtime/chat.gateway';

// 실제 서버를 띄워 socket.io 클라이언트로 접속한다.
describe('ChatGateway (e2e)', () => {
  let app: INestApplication<Server>;
  let url: string;
  let dataSource: DataSource;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://localhost:${port}/chat`;
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM snapshots');
    await dataSource.query('DELETE FROM messages');
    await dataSource.query('DELETE FROM participants');
    await dataSource.query('DELETE FROM sessions');
  });

  // 연결 끊김의 PRESENCE_OFFLINE 저장이 끝난 뒤에 다음 테스트가 테이블을 비우게 한다.
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    const gateway = app.get(ChatGateway);
    const deadline = Date.now() + 2000;
    while (
      gateway['presence']['subscriptions'].size > 0 ||
      gateway['presenceQueue'].size > 0
    ) {
      if (Date.now() > deadline) {
        throw new Error('presence 처리가 끝나지 않았습니다.');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  afterAll(() => app.close());

  function connect(auth: Record<string, unknown>): Socket {
    const socket = io(url, {
      auth,
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  function outcome(socket: Socket) {
    return new Promise<{ connected: boolean; data?: unknown }>((resolve) => {
      socket.on('connect', () => resolve({ connected: true }));
      socket.on('connect_error', (error: Error & { data?: unknown }) =>
        resolve({ connected: false, data: error.data }),
      );
    });
  }

  it('/chat namespace에 handshake userId로 접속한다', async () => {
    await expect(outcome(connect({ userId: 'user-a' }))).resolves.toEqual({
      connected: true,
    });
  });

  it('userId가 없으면 연결을 거부하고 공통 에러 형식을 준다', async () => {
    await expect(outcome(connect({}))).resolves.toEqual({
      connected: false,
      data: {
        success: false,
        code: 'UNAUTHORIZED',
        message: '사용자 식별 정보가 없습니다.',
      },
    });
  });

  it('64자를 넘는 userId는 VALIDATION_ERROR로 거부한다', async () => {
    const result = await outcome(connect({ userId: 'a'.repeat(65) }));
    expect(result.connected).toBe(false);
    expect(result.data).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  describe('session:subscribe / session:unsubscribe', () => {
    async function createSession(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '상담 문의' })
        .expect(201);
      return (res.body as { data: { id: string } }).data.id;
    }

    async function connected(userId: string): Promise<Socket> {
      const socket = connect({ userId });
      await outcome(socket);
      return socket;
    }

    it('참여자는 구독하고 해제할 수 있다', async () => {
      const sessionId = await createSession();
      const socket = await connected('user-a');

      await expect(
        socket.emitWithAck('session:subscribe', { sessionId }),
      ).resolves.toEqual({ success: true, data: { sessionId } });
      await expect(
        socket.emitWithAck('session:unsubscribe', { sessionId }),
      ).resolves.toEqual({ success: true, data: { sessionId } });
    });

    it('나간 참여자도 구독할 수 있다', async () => {
      const sessionId = await createSession();
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-a')
        .send({ clientEventId: uuidv4(), type: 'PARTICIPANT_LEFT' })
        .expect(201);
      const socket = await connected('user-a');

      await expect(
        socket.emitWithAck('session:subscribe', { sessionId }),
      ).resolves.toMatchObject({ success: true });
    });

    it('참여자가 아니면 NOT_PARTICIPANT를 ack와 session:error로 받는다', async () => {
      const sessionId = await createSession();
      const socket = await connected('user-c');
      const errorEvent = new Promise((resolve) =>
        socket.once('session:error', resolve),
      );

      const failure = {
        success: false,
        code: 'NOT_PARTICIPANT',
        message: '세션 참여자가 아닙니다.',
      };
      await expect(
        socket.emitWithAck('session:subscribe', { sessionId }),
      ).resolves.toEqual(failure);
      await expect(errorEvent).resolves.toEqual(failure);
    });

    it('없는 세션은 SESSION_NOT_FOUND', async () => {
      const socket = await connected('user-a');
      await expect(
        socket.emitWithAck('session:subscribe', {
          sessionId: '0192a3b4-0000-7000-8000-000000000000',
        }),
      ).resolves.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    });
  });

  describe('presence', () => {
    async function createSession(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '상담 문의' })
        .expect(201);
      return (res.body as { data: { id: string } }).data.id;
    }

    async function subscribed(sessionId: string): Promise<Socket> {
      const socket = connect({ userId: 'user-a' });
      await outcome(socket);
      await socket.emitWithAck('session:subscribe', { sessionId });
      return socket;
    }

    async function presenceEvents(sessionId: string): Promise<string[]> {
      const rows = await dataSource.query<{ type: string }[]>(
        "SELECT type FROM messages WHERE session_id = ? AND type LIKE 'PRESENCE_%' ORDER BY seq",
        [sessionId],
      );
      return rows.map((row) => row.type);
    }

    async function presenceOf(sessionId: string): Promise<string> {
      const [row] = await dataSource.query<{ presence: string }[]>(
        "SELECT presence FROM participants WHERE session_id = ? AND user_id = 'user-a'",
        [sessionId],
      );
      return row.presence;
    }

    // 연결 끊김은 서버가 비동기로 처리하므로 조건이 맞을 때까지 기다린다.
    async function eventually(check: () => Promise<void>): Promise<void> {
      const deadline = Date.now() + 2000;
      for (;;) {
        try {
          return await check();
        } catch (error) {
          if (Date.now() > deadline) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }

    it('첫 구독에 ONLINE, 모든 탭의 연결이 끊기면 OFFLINE을 저장한다', async () => {
      const sessionId = await createSession();
      const tab1 = await subscribed(sessionId);
      const tab2 = await subscribed(sessionId);
      expect(await presenceEvents(sessionId)).toEqual(['PRESENCE_ONLINE']);
      expect(await presenceOf(sessionId)).toBe('ONLINE');

      tab1.disconnect();
      // 한 탭이 남아 있으면 OFFLINE이 아니다.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await presenceEvents(sessionId)).toEqual(['PRESENCE_ONLINE']);

      tab2.disconnect();
      await eventually(async () => {
        expect(await presenceEvents(sessionId)).toEqual([
          'PRESENCE_ONLINE',
          'PRESENCE_OFFLINE',
        ]);
      });
      expect(await presenceOf(sessionId)).toBe('OFFLINE');
    });

    it('구독을 해제해도 마지막이면 OFFLINE, 다시 구독하면 ONLINE이다', async () => {
      const sessionId = await createSession();
      const socket = await subscribed(sessionId);
      await socket.emitWithAck('session:unsubscribe', { sessionId });
      expect(await presenceOf(sessionId)).toBe('OFFLINE');

      await socket.emitWithAck('session:subscribe', { sessionId });
      expect(await presenceEvents(sessionId)).toEqual([
        'PRESENCE_ONLINE',
        'PRESENCE_OFFLINE',
        'PRESENCE_ONLINE',
      ]);
    });

    it('presence 이벤트도 seq를 받아 타임라인 복원에 포함된다', async () => {
      const sessionId = await createSession();
      await subscribed(sessionId);
      const res = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}/timeline`)
        .set('X-User-Id', 'user-a')
        .query({ at: '2999-01-01T00:00:00.000Z' })
        .expect(200);
      expect(
        (res.body as { data: { seq: number; state: unknown } }).data,
      ).toMatchObject({
        seq: 3,
        state: { participants: [{ userId: 'user-a', presence: 'ONLINE' }] },
      });
    });

    it('서버가 시작할 때 ONLINE으로 남은 참여자를 OFFLINE으로 기록한다', async () => {
      const sessionId = await createSession();
      await subscribed(sessionId);
      expect(await presenceOf(sessionId)).toBe('ONLINE');

      // 재시작을 흉내 낸다: 새 앱 인스턴스는 이 연결을 모른다.
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const restarted = moduleRef.createNestApplication();
      await restarted.init();
      await restarted.close();

      expect(await presenceEvents(sessionId)).toEqual([
        'PRESENCE_ONLINE',
        'PRESENCE_OFFLINE',
      ]);
      expect(await presenceOf(sessionId)).toBe('OFFLINE');
    });
  });

  describe('session:event broadcast', () => {
    interface Event {
      seq: number;
      type: string;
      actorId: string;
      payload: Record<string, unknown>;
    }

    function http() {
      return request(app.getHttpServer());
    }

    async function createWithTwo(): Promise<string> {
      const res = await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '상담 문의' })
        .expect(201);
      const sessionId = (res.body as { data: { id: string } }).data.id;
      await http()
        .post(`/sessions/${sessionId}/join`)
        .set('X-User-Id', 'user-b')
        .expect(201);
      return sessionId;
    }

    // 받은 session:event를 모은다.
    async function listener(userId: string, sessionId?: string) {
      const socket = connect({ userId });
      await outcome(socket);
      const received: Event[] = [];
      socket.on('session:event', (event: Event) => received.push(event));
      if (sessionId) {
        await socket.emitWithAck('session:subscribe', { sessionId });
      }
      return { socket, received };
    }

    function message(
      sessionId: string,
      userId: string,
      clientEventId = uuidv4(),
    ) {
      return http()
        .post(`/sessions/${sessionId}/events`)
        .set('X-User-Id', userId)
        .send({
          clientEventId,
          type: 'MESSAGE_CREATED',
          payload: { content: '안녕' },
        });
    }

    async function waitFor(check: () => boolean): Promise<void> {
      const deadline = Date.now() + 2000;
      while (!check()) {
        if (Date.now() > deadline) {
          throw new Error('기다리던 이벤트가 오지 않았습니다.');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    it('REST로 저장된 이벤트를 구독자 모두에게 응답과 같은 형식으로 전달한다', async () => {
      const sessionId = await createWithTwo();
      const a = await listener('user-a', sessionId);
      const b = await listener('user-b', sessionId);
      await waitFor(() => a.received.some((e) => e.actorId === 'user-b'));

      const res = await message(sessionId, 'user-b').expect(201);
      const saved = (res.body as { data: Event }).data;

      await waitFor(
        () =>
          a.received.some((e) => e.seq === saved.seq) &&
          b.received.some((e) => e.seq === saved.seq),
      );
      expect(a.received.find((e) => e.seq === saved.seq)).toEqual(saved);
      expect(b.received.find((e) => e.seq === saved.seq)).toEqual(saved);
    });

    it('다른 참여자의 presence 변화도 전달한다', async () => {
      const sessionId = await createWithTwo();
      const a = await listener('user-a', sessionId);
      const b = await listener('user-b', sessionId);

      await waitFor(() =>
        a.received.some(
          (e) => e.type === 'PRESENCE_ONLINE' && e.actorId === 'user-b',
        ),
      );
      b.socket.disconnect();
      await waitFor(() =>
        a.received.some(
          (e) => e.type === 'PRESENCE_OFFLINE' && e.actorId === 'user-b',
        ),
      );
    });

    it('중복 요청(같은 clientEventId, 다시 참여, 다시 종료)은 다시 전달하지 않는다', async () => {
      const sessionId = await createWithTwo();
      const a = await listener('user-a', sessionId);
      const clientEventId = uuidv4();
      await message(sessionId, 'user-a', clientEventId).expect(201);
      await http()
        .post(`/sessions/${sessionId}/end`)
        .set('X-User-Id', 'user-a')
        .expect(201);
      await waitFor(() => a.received.some((e) => e.type === 'SESSION_ENDED'));
      const before = a.received.length;

      await message(sessionId, 'user-a', clientEventId).expect(200);
      await http()
        .post(`/sessions/${sessionId}/join`)
        .set('X-User-Id', 'user-b')
        .expect(200);
      await http()
        .post(`/sessions/${sessionId}/end`)
        .set('X-User-Id', 'user-b')
        .expect(200);
      await settle();
      expect(a.received).toHaveLength(before);
    });

    it('실패한 요청은 전달하지 않는다', async () => {
      const sessionId = await createWithTwo();
      const a = await listener('user-a', sessionId);
      await settle();
      const before = a.received.length;

      await message(sessionId, 'user-c').expect(403);
      await settle();
      expect(a.received).toHaveLength(before);
    });

    it('구독하지 않았거나 해제한 소켓, 다른 세션 구독자는 받지 않는다', async () => {
      const sessionId = await createWithTwo();
      const other = await createWithTwo();
      const notSubscribed = await listener('user-a');
      const otherSession = await listener('user-a', other);
      const unsubscribed = await listener('user-b', sessionId);
      await unsubscribed.socket.emitWithAck('session:unsubscribe', {
        sessionId,
      });
      await settle();
      unsubscribed.received.length = 0;
      otherSession.received.length = 0;

      await message(sessionId, 'user-a').expect(201);
      await settle();
      expect(notSubscribed.received).toEqual([]);
      expect(otherSession.received).toEqual([]);
      expect(unsubscribed.received).toEqual([]);
    });

    it('이벤트는 seq 순서로 전달된다', async () => {
      const sessionId = await createWithTwo();
      const a = await listener('user-a', sessionId);
      await settle();
      a.received.length = 0;

      for (let i = 0; i < 5; i++) {
        await message(sessionId, i % 2 ? 'user-a' : 'user-b').expect(201);
      }
      await waitFor(() => a.received.length === 5);
      const seqs = a.received.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    });
  });
});
