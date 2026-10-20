import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
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

  // events/end 엔드포인트가 생기기 전까지는 EventService로 상태를 만든다.
  function leave(sessionId: string, userId: string) {
    return eventService.append(sessionId, {
      type: EventType.PARTICIPANT_LEFT,
      actorId: userId,
    });
  }

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
});
