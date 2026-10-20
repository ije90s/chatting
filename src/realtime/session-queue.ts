import { Injectable } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';

// 세션별로 작업을 호출 순서대로 하나씩 실행한다(프로세스 메모리, 단일 인스턴스 기준).
// "저장 → 커밋 → broadcast"를 한 작업으로 넣으면 broadcast가 seq 순서로 나간다.
// 같은 세션의 쓰기는 DB 세션 잠금으로 이미 직렬화되므로 처리량은 거의 줄지 않는다.
@Injectable()
export class SessionQueue {
  // 세션별 마지막 작업. 실패해도 다음 작업이 이어지도록 항상 resolve되는 Promise를 둔다.
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly metrics: MetricsService) {}

  run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(sessionId, tail);
    this.metrics.sessionQueuePending.inc();
    void tail.then(() => {
      this.metrics.sessionQueuePending.dec();
      if (this.tails.get(sessionId) === tail) {
        this.tails.delete(sessionId);
      }
    });
    return result;
  }

  // 지금까지 넣은 작업이 모두 끝날 때까지 기다린다.
  async idle(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all(this.tails.values());
    }
  }
}
