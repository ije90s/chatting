import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

// 매칭되지 않은 경로는 하나로 묶는다. 경로 원문을 라벨로 쓰면 시계열이 무한히 늘어난다.
export const UNMATCHED_ROUTE = 'unmatched';

// 응답이 끝난 시점에 라우트 패턴(/sessions/:id/join)과 상태 코드로 처리 시간을 기록한다.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = routeOf(req);
      // 수집 요청 자체는 기록하지 않는다.
      if (route === '/metrics') {
        return;
      }
      end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  }
}

export function routeOf(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : UNMATCHED_ROUTE;
}
