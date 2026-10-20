import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';

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

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
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
});
