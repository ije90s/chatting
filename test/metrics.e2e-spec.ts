import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
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
});
