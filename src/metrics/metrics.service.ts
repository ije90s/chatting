import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { AppException } from '../common/errors/app.exception';

// 이벤트 저장 요청의 결과. created: 새로 저장, duplicate: 기존 이벤트 반환(중복·멱등),
// rejected: 도메인 규칙 위반(4xx), error: 그 밖의 실패(DB 오류 등)
export type AppendResult = 'created' | 'duplicate' | 'rejected' | 'error';

// 프로세스별 메트릭 저장소. 인스턴스마다 자기 Registry를 가지므로 테스트에서 여러 앱을 만들어도 이름이 겹치지 않는다.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'REST 요청 처리 시간',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly eventAppends = new Counter({
    name: 'chat_event_appends_total',
    help: '이벤트 저장 요청 수 (요청한 이벤트 타입, 결과별)',
    labelNames: ['type', 'result'] as const,
    registers: [this.registry],
  });

  readonly eventAppendDuration = new Histogram({
    name: 'chat_event_append_duration_seconds',
    help: '세션 잠금부터 커밋까지 이벤트 저장 시간 (세션 큐 대기 제외)',
    labelNames: ['type'] as const,
    buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  readonly broadcastFailures = new Counter({
    name: 'chat_broadcast_failures_total',
    help: '커밋 후 socket 전달에 실패한 이벤트 수',
    registers: [this.registry],
  });

  readonly socketConnections = new Gauge({
    name: 'chat_socket_connections',
    help: '현재 연결된 socket 수 (/chat)',
    registers: [this.registry],
  });

  readonly sessionQueuePending = new Gauge({
    name: 'chat_session_queue_pending',
    help: '세션 큐에서 실행 중이거나 기다리는 작업 수',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  // 저장 호출의 결과와 시간을 기록한다. 결과와 예외는 그대로 돌려준다.
  async observeAppend<T extends { created: boolean }>(
    type: string,
    append: () => Promise<T>,
  ): Promise<T> {
    const end = this.eventAppendDuration.startTimer({ type });
    let result: AppendResult = 'error';
    try {
      const value = await append();
      result = value.created ? 'created' : 'duplicate';
      return value;
    } catch (error) {
      result = error instanceof AppException ? 'rejected' : 'error';
      throw error;
    } finally {
      end();
      this.eventAppends.inc({ type, result });
    }
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
