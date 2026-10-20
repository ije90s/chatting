import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { SessionQueue } from '../src/realtime/session-queue';

interface Event {
  eventId: number;
  seq: number;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

interface Timeline {
  seq: number;
  state: {
    status: string;
    participants: {
      userId: string;
      leftAt: string | null;
      presence: string;
    }[];
    messageCount: number;
    lastMessage: { seq: number; content: string } | null;
  };
}

// 전체 흐름: 생성 → 참여 → 구독(presence) → 메시지(재전송 중복 포함) → 나가기 → 종료 → 타임라인 복원.
// REST 응답, socket 수신, 누락 조회, 목록, 타임라인이 같은 이벤트 로그를 보는지 함께 확인한다.
describe('전체 흐름 (e2e)', () => {
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
    await dataSource.query('DELETE FROM snapshots');
    await dataSource.query('DELETE FROM messages');
    await dataSource.query('DELETE FROM participants');
    await dataSource.query('DELETE FROM sessions');
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.get(SessionQueue).idle();
    await app.close();
  });

  function http() {
    return request(app.getHttpServer());
  }

  function as<T>(res: request.Response): T {
    return (res.body as { data: T }).data;
  }

  async function subscriber(userId: string, sessionId: string) {
    const socket = io(url, {
      auth: { userId },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    const received: Event[] = [];
    socket.on('session:event', (event: Event) => received.push(event));
    await new Promise<void>((resolve) => socket.on('connect', resolve));
    await socket.emitWithAck('session:subscribe', { sessionId });
    return { socket, received };
  }

  async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error('기다리던 상태가 되지 않았습니다.');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function timelineAt(sessionId: string, at: string) {
    const res = await http()
      .get(`/sessions/${sessionId}/timeline`)
      .set('X-User-Id', 'user-a')
      .query({ at })
      .expect(200);
    return as<Timeline>(res);
  }

  it('한 세션의 전체 수명주기가 REST, socket, 복원에서 일치한다', async () => {
    // 1. 생성: seq 1 SESSION_CREATED, seq 2 생성자 PARTICIPANT_JOINED
    const created = as<{ id: string; status: string; lastSeq: number }>(
      await http()
        .post('/sessions')
        .set('X-User-Id', 'user-a')
        .send({ title: '  상담 문의 ' })
        .expect(201),
    );
    expect(created).toMatchObject({ status: 'JOIN', lastSeq: 2 });
    const sessionId = created.id;

    // 2. 참여: seq 3. 세 번째 사용자는 거절
    const joined = as<Event>(
      await http()
        .post(`/sessions/${sessionId}/join`)
        .set('X-User-Id', 'user-b')
        .expect(201),
    );
    expect(joined.seq).toBe(3);
    await http()
      .post(`/sessions/${sessionId}/join`)
      .set('X-User-Id', 'user-c')
      .expect(409);

    // 3. 구독: 각자 PRESENCE_ONLINE(seq 4, 5). user-a는 user-b의 ONLINE을 받는다.
    const a = await subscriber('user-a', sessionId);
    const b = await subscriber('user-b', sessionId);
    await waitFor(() =>
      a.received.some(
        (e) => e.type === 'PRESENCE_ONLINE' && e.actorId === 'user-b',
      ),
    );

    // 4. 메시지 3건. 첫 메시지는 응답이 유실됐다고 보고 같은 clientEventId로 재전송한다.
    const firstKey = uuidv4();
    const send = (userId: string, content: string, clientEventId = uuidv4()) =>
      http()
        .post(`/sessions/${sessionId}/events`)
        .set('X-User-Id', userId)
        .send({
          clientEventId,
          type: 'MESSAGE_CREATED',
          payload: { content },
          clientSentAt: '2026-10-19T15:20:00.000+09:00',
        });
    const m1 = as<Event>(
      await send('user-a', '안녕하세요', firstKey).expect(201),
    );
    const resent = as<Event>(
      await send('user-a', '안녕하세요', firstKey).expect(200),
    );
    expect(resent).toEqual(m1);
    const m2 = as<Event>(await send('user-b', '네 안녕하세요').expect(201));
    const m3 = as<Event>(await send('user-a', '문의드립니다 😀').expect(201));
    expect([m1.seq, m2.seq, m3.seq]).toEqual([6, 7, 8]);

    // 5. 나가기: seq 9, 세션 LEAVE. 나간 사용자의 메시지는 거절, 다시 나가기는 기존 이벤트
    const left = as<Event>(
      await http()
        .post(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-b')
        .send({ clientEventId: uuidv4(), type: 'PARTICIPANT_LEFT' })
        .expect(201),
    );
    expect(left.seq).toBe(9);
    await send('user-b', '하나 더').expect(409);
    await http()
      .post(`/sessions/${sessionId}/events`)
      .set('X-User-Id', 'user-b')
      .send({ clientEventId: uuidv4(), type: 'PARTICIPANT_LEFT' })
      .expect(200);

    // 6. 종료: 남은 참여자만 가능. seq 10, 세션 END. 다시 종료는 기존 이벤트
    await http()
      .post(`/sessions/${sessionId}/end`)
      .set('X-User-Id', 'user-b')
      .expect(403);
    const ended = as<Event>(
      await http()
        .post(`/sessions/${sessionId}/end`)
        .set('X-User-Id', 'user-a')
        .expect(201),
    );
    expect(ended.seq).toBe(10);
    await http()
      .post(`/sessions/${sessionId}/end`)
      .set('X-User-Id', 'user-a')
      .expect(200);

    // 7. socket: user-a는 구독 이후 이벤트를 중복 없이 seq 순서로 받았다.
    await waitFor(() => a.received.some((e) => e.type === 'SESSION_ENDED'));
    const aSeqs = a.received.map((e) => e.seq);
    expect(aSeqs[0]).toBeLessThanOrEqual(5);
    expect(aSeqs).toEqual(
      Array.from({ length: 10 - aSeqs[0] + 1 }, (_, i) => aSeqs[0] + i),
    );
    expect(a.received.find((e) => e.seq === 6)).toEqual(m1);

    // 8. 누락 조회: 나간 user-b가 마지막으로 받은 seq 이후를 채우면 전체 로그와 이어진다.
    await waitFor(() => b.received.some((e) => e.seq === 10));
    const bLast = Math.max(...b.received.map((e) => e.seq));
    const all = as<{ items: Event[]; hasMore: boolean }>(
      await http()
        .get(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-b')
        .expect(200),
    );
    expect(all.hasMore).toBe(false);
    expect(all.items.map((e) => e.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(all.items.find((e) => e.seq === 6)).toEqual(m1);
    const missed = as<{ items: Event[] }>(
      await http()
        .get(`/sessions/${sessionId}/events`)
        .set('X-User-Id', 'user-b')
        .query({ afterSeq: bLast })
        .expect(200),
    );
    expect(missed.items).toEqual([]);

    // 9. 목록: 최종 상태
    const listed = as<{
      items: { id: string; title: string; status: string; lastSeq: number }[];
    }>(
      await http()
        .get('/sessions')
        .set('X-User-Id', 'user-a')
        .query({ participantId: 'user-b', status: 'END' })
        .expect(200),
    );
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: sessionId,
        title: '상담 문의',
        status: 'END',
        lastSeq: 10,
      }),
    ]);

    // 10. 타임라인: 각 단계 시점의 상태
    const at = (seq: number) =>
      all.items.find((e) => e.seq === seq)!.receivedAt;
    const afterJoin = await timelineAt(sessionId, at(3));
    expect(afterJoin.seq).toBe(3);
    expect(afterJoin.state).toMatchObject({
      status: 'JOIN',
      messageCount: 0,
      participants: [
        { userId: 'user-a', presence: 'OFFLINE' },
        { userId: 'user-b', presence: 'OFFLINE' },
      ],
    });

    // 각 이벤트는 순서대로 보낸 별도 요청이라 receivedAt이 겹치지 않는다.
    const afterMessages = await timelineAt(sessionId, at(8));
    expect(afterMessages).toMatchObject({
      seq: 8,
      state: {
        status: 'JOIN',
        messageCount: 3,
        lastMessage: { seq: 8, content: '문의드립니다 😀' },
        participants: [
          { userId: 'user-a', presence: 'ONLINE' },
          { userId: 'user-b', presence: 'ONLINE' },
        ],
      },
    });

    const afterLeave = await timelineAt(sessionId, at(9));
    expect(afterLeave).toMatchObject({ seq: 9, state: { status: 'LEAVE' } });
    expect(
      afterLeave.state.participants.find((p) => p.userId === 'user-b')!.leftAt,
    ).not.toBeNull();

    const final = await timelineAt(sessionId, '2999-01-01T00:00:00.000Z');
    expect(final).toMatchObject({
      seq: 10,
      state: { status: 'END', messageCount: 3 },
    });

    // 11. 연결을 끊으면 PRESENCE_OFFLINE이 남고, 복원 결과에 반영된다.
    a.socket.disconnect();
    b.socket.disconnect();
    const deadline = Date.now() + 3000;
    for (;;) {
      const [{ lastSeq }] = await dataSource.query<{ lastSeq: number }[]>(
        'SELECT last_seq AS lastSeq FROM sessions WHERE id = ?',
        [sessionId],
      );
      if (Number(lastSeq) === 12 || Date.now() > deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const afterOffline = await timelineAt(
      sessionId,
      '2999-01-01T00:00:00.000Z',
    );
    expect(afterOffline.seq).toBe(12);
    expect(afterOffline.state.participants.map((p) => p.presence)).toEqual([
      'OFFLINE',
      'OFFLINE',
    ]);
  });
});
