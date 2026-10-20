import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';

describe('GET /metrics (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  function http() {
    return request(app.getHttpServer());
  }

  function countLine(text: string, labels: string): number {
    const line = text
      .split('\n')
      .find((l) =>
        l.startsWith(`http_request_duration_seconds_count{${labels}}`),
      );
    return line ? Number(line.split(' ').at(-1)) : 0;
  }

  it('X-User-Id 없이 Prometheus 텍스트를 감싸지 않고 돌려준다', async () => {
    const res = await http().get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('# TYPE process_cpu_seconds_total counter');
    expect(res.text).not.toContain('"success"');
  });

  it('요청을 라우트 패턴과 상태 코드별로 기록한다', async () => {
    await http().get('/sessions/not-a-session/events').expect(401);
    await http().get('/sessions/another/events').expect(401);
    await http().get('/no-such-path').expect(404);

    const { text } = await http().get('/metrics').expect(200);
    expect(
      countLine(text, 'method="GET",route="/sessions/:id/events",status="401"'),
    ).toBe(2);
    expect(countLine(text, 'method="GET",route="unmatched",status="404"')).toBe(
      1,
    );
    expect(text).not.toContain('route="/metrics"');
    expect(text).not.toContain('not-a-session');
  });

  it('다른 엔드포인트의 공통 응답 형식은 그대로다', async () => {
    await http()
      .get('/')
      .expect(200)
      .expect({ success: true, data: 'Hello World!' });
  });

  function sampleOf(text: string, metric: string, labels: string): number {
    const line = text
      .split('\n')
      .find((l) =>
        l.startsWith(labels ? `${metric}{${labels}} ` : `${metric} `),
      );
    return line ? Number(line.split(' ').at(-1)) : NaN;
  }

  it('REST 쓰기의 저장 결과를 이벤트 타입과 결과별로 센다', async () => {
    const before = (await http().get('/metrics')).text;
    // 처음 나오는 라벨 조합은 이전 값이 없으므로 0으로 본다.
    const count = (text: string, type: string, result: string) =>
      sampleOf(
        text,
        'chat_event_appends_total',
        `type="${type}",result="${result}"`,
      ) || 0;

    const created = await http()
      .post('/sessions')
      .set('X-User-Id', 'metrics-a')
      .send({ title: '메트릭' })
      .expect(201);
    const sessionId = (created.body as { data: { id: string } }).data.id;
    await http()
      .post(`/sessions/${sessionId}/join`)
      .set('X-User-Id', 'metrics-b')
      .expect(201);
    await http()
      .post(`/sessions/${sessionId}/join`)
      .set('X-User-Id', 'metrics-c')
      .expect(409);
    const message = {
      type: 'MESSAGE_CREATED',
      clientEventId: uuidv4(),
      payload: { content: '안녕하세요' },
    };
    await http()
      .post(`/sessions/${sessionId}/events`)
      .set('X-User-Id', 'metrics-a')
      .send(message)
      .expect(201);
    await http()
      .post(`/sessions/${sessionId}/events`)
      .set('X-User-Id', 'metrics-a')
      .send(message)
      .expect(200);

    const after = (await http().get('/metrics')).text;
    const delta = (type: string, result: string) =>
      count(after, type, result) - count(before, type, result);
    expect(delta('SESSION_CREATED', 'created')).toBe(1);
    expect(delta('PARTICIPANT_JOINED', 'created')).toBe(1);
    expect(delta('PARTICIPANT_JOINED', 'rejected')).toBe(1);
    expect(delta('MESSAGE_CREATED', 'created')).toBe(1);
    expect(delta('MESSAGE_CREATED', 'duplicate')).toBe(1);
    expect(after).toContain('chat_event_append_duration_seconds_bucket');
    expect(sampleOf(after, 'chat_session_queue_pending', '')).toBe(0);
    expect(after).not.toContain(sessionId);
  });
});
