import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  HttpMetricsMiddleware,
  routeOf,
  UNMATCHED_ROUTE,
} from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

function request(method: string, routePath?: string): Request {
  return {
    method,
    baseUrl: '',
    route: routePath === undefined ? undefined : { path: routePath },
  } as unknown as Request;
}

function response(statusCode: number): Response & EventEmitter {
  return Object.assign(new EventEmitter(), { statusCode }) as Response &
    EventEmitter;
}

async function countOf(
  metrics: MetricsService,
  labels: Record<string, string>,
) {
  const metric = await metrics.httpRequestDuration.get();
  const sample = metric.values.find(
    (v) =>
      v.metricName === 'http_request_duration_seconds_count' &&
      Object.entries(labels).every(([k, value]) => v.labels[k] === value),
  );
  return sample?.value ?? 0;
}

describe('routeOf', () => {
  it('매칭된 라우트는 경로 원문이 아니라 패턴을 돌려준다', () => {
    expect(routeOf(request('POST', '/sessions/:id/join'))).toBe(
      '/sessions/:id/join',
    );
  });

  it('매칭되지 않은 요청은 하나의 라벨로 묶는다', () => {
    expect(routeOf(request('GET'))).toBe(UNMATCHED_ROUTE);
  });
});

describe('HttpMetricsMiddleware', () => {
  let metrics: MetricsService;
  let middleware: HttpMetricsMiddleware;

  beforeEach(() => {
    metrics = new MetricsService();
    middleware = new HttpMetricsMiddleware(metrics);
  });

  it('응답이 끝나면 method, route, status로 처리 시간을 기록한다', async () => {
    const req = request('POST', '/sessions/:id/join');
    const res = response(201);
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(await countOf(metrics, { route: '/sessions/:id/join' })).toBe(0);

    res.emit('finish');
    expect(
      await countOf(metrics, {
        method: 'POST',
        route: '/sessions/:id/join',
        status: '201',
      }),
    ).toBe(1);
  });

  it('수집 요청(/metrics)은 기록하지 않는다', async () => {
    const res = response(200);
    middleware.use(request('GET', '/metrics'), res, jest.fn());
    res.emit('finish');
    expect(await countOf(metrics, { route: '/metrics' })).toBe(0);
  });
});
