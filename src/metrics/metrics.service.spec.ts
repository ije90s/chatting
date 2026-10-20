import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { MetricsService } from './metrics.service';
import { readMetric } from './read-metric';

describe('MetricsService', () => {
  it('Prometheus 텍스트 형식으로 기본 Node 메트릭과 HTTP 지연을 내보낸다', async () => {
    const metrics = new MetricsService();
    const text = await metrics.render();

    expect(metrics.contentType).toMatch(/^text\/plain/);
    expect(text).toContain('# TYPE process_cpu_seconds_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(text).toContain('# TYPE chat_event_appends_total counter');
    expect(text).toContain('# TYPE chat_socket_connections gauge');
  });

  it('인스턴스마다 Registry가 따로 있어 여러 번 만들어도 충돌하지 않는다', () => {
    expect(() => [new MetricsService(), new MetricsService()]).not.toThrow();
  });
});

describe('MetricsService.observeAppend', () => {
  let metrics: MetricsService;
  const appends = (type: string, result: string) =>
    readMetric(metrics.registry, 'chat_event_appends_total', { type, result });
  const timings = (type: string) =>
    readMetric(metrics.registry, 'chat_event_append_duration_seconds_count', {
      type,
    });

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('새로 저장하면 created, 기존 이벤트를 돌려주면 duplicate로 센다', async () => {
    const created = { created: true };
    await expect(
      metrics.observeAppend('MESSAGE_CREATED', () => Promise.resolve(created)),
    ).resolves.toBe(created);
    await metrics.observeAppend('MESSAGE_CREATED', () =>
      Promise.resolve({ created: false }),
    );

    expect(await appends('MESSAGE_CREATED', 'created')).toBe(1);
    expect(await appends('MESSAGE_CREATED', 'duplicate')).toBe(1);
    expect(await timings('MESSAGE_CREATED')).toBe(2);
  });

  it('도메인 규칙 위반(AppException)은 rejected, 그 밖의 예외는 error로 세고 그대로 던진다', async () => {
    const domain = new AppException(ErrorCode.SESSION_FULL);
    const db = new Error('connection lost');
    await expect(
      metrics.observeAppend('PARTICIPANT_JOINED', () => Promise.reject(domain)),
    ).rejects.toBe(domain);
    await expect(
      metrics.observeAppend('PARTICIPANT_JOINED', () => Promise.reject(db)),
    ).rejects.toBe(db);

    expect(await appends('PARTICIPANT_JOINED', 'rejected')).toBe(1);
    expect(await appends('PARTICIPANT_JOINED', 'error')).toBe(1);
    expect(await appends('PARTICIPANT_JOINED', 'created')).toBe(0);
    expect(await timings('PARTICIPANT_JOINED')).toBe(2);
  });
});
