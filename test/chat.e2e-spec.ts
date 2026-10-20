import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

// 실제 서버를 띄워 socket.io 클라이언트로 접속한다.
describe('ChatGateway (e2e)', () => {
  let app: INestApplication<Server>;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://localhost:${port}/chat`;
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
});
