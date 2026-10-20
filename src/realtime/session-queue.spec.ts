import { SessionQueue } from './session-queue';
import { MetricsService } from '../metrics/metrics.service';
import { readMetric } from '../metrics/read-metric';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise(setImmediate);

describe('SessionQueue', () => {
  let queue: SessionQueue;
  let metrics: MetricsService;
  const pending = () =>
    readMetric(metrics.registry, 'chat_session_queue_pending');

  beforeEach(() => {
    metrics = new MetricsService();
    queue = new SessionQueue(metrics);
  });

  it('같은 세션의 작업은 앞선 작업이 끝난 뒤 호출 순서대로 시작한다', async () => {
    const order: string[] = [];
    const first = deferred<string>();
    const a = queue.run('s1', () => {
      order.push('start a');
      return first.promise;
    });
    const b = queue.run('s1', () => {
      order.push('start b');
      return Promise.resolve('b');
    });
    await tick();
    expect(order).toEqual(['start a']);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(order).toEqual(['start a', 'start b']);
  });

  it('다른 세션의 작업은 기다리지 않는다', async () => {
    const blocked = deferred<void>();
    void queue.run('s1', () => blocked.promise);
    await expect(queue.run('s2', () => Promise.resolve('s2'))).resolves.toBe(
      's2',
    );
    blocked.resolve();
  });

  it('앞선 작업이 실패해도 그 결과는 호출자에게만 가고 다음 작업은 실행된다', async () => {
    const a = queue.run('s1', () => Promise.reject(new Error('fail')));
    const b = queue.run('s1', () => Promise.resolve('b'));
    await expect(a).rejects.toThrow('fail');
    await expect(b).resolves.toBe('b');
  });

  it('idle은 넣은 작업이 모두 끝나면 끝나고, 끝난 세션은 정리한다', async () => {
    const pending = deferred<void>();
    let done = false;
    void queue.run('s1', () => pending.promise).then(() => (done = true));
    const idle = queue.idle();
    await tick();
    expect(done).toBe(false);

    pending.resolve();
    await idle;
    expect(done).toBe(true);
    expect(queue['tails'].size).toBe(0);
  });
  it('실행 중이거나 기다리는 작업 수를 메트릭으로 내보내고, 실패한 작업도 끝나면 뺀다', async () => {
    const first = deferred<void>();
    const a = queue.run('s1', () => first.promise);
    const b = queue.run('s1', () => Promise.reject(new Error('fail')));
    const c = queue.run('s2', () => Promise.resolve());
    expect(await pending()).toBe(3);

    await c;
    await tick();
    expect(await pending()).toBe(2);

    first.resolve();
    await a;
    await expect(b).rejects.toThrow('fail');
    await queue.idle();
    expect(await pending()).toBe(0);
  });
});
