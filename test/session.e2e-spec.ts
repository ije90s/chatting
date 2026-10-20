import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
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
      ['101자 제목', { title: '가'.repeat(101) }],
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
});
