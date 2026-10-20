import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('Prometheus 텍스트 형식으로 기본 Node 메트릭과 HTTP 지연을 내보낸다', async () => {
    const metrics = new MetricsService();
    const text = await metrics.render();

    expect(metrics.contentType).toMatch(/^text\/plain/);
    expect(text).toContain('# TYPE process_cpu_seconds_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('인스턴스마다 Registry가 따로 있어 여러 번 만들어도 충돌하지 않는다', () => {
    expect(() => [new MetricsService(), new MetricsService()]).not.toThrow();
  });
});
