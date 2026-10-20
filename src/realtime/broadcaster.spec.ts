import { Namespace } from 'socket.io';
import { EventDto } from '../event/dto/event.dto';
import { Broadcaster } from './broadcaster';
import { MetricsService } from '../metrics/metrics.service';
import { readMetric } from '../metrics/read-metric';

const event = (seq: number) =>
  ({ sessionId: 's1', seq, type: 'MESSAGE_CREATED' }) as EventDto;

describe('Broadcaster', () => {
  let broadcaster: Broadcaster;
  let metrics: MetricsService;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    metrics = new MetricsService();
    broadcaster = new Broadcaster(metrics);
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    broadcaster.attach({ to } as unknown as Namespace);
  });

  it('이벤트를 session:{id} room에 session:event로 순서대로 보낸다', () => {
    broadcaster.broadcast([event(1), event(2)]);
    expect(to).toHaveBeenCalledWith('session:s1');
    expect(emit.mock.calls).toEqual([
      ['session:event', event(1)],
      ['session:event', event(2)],
    ]);
  });

  it('namespace가 연결되기 전에는 아무것도 하지 않는다', () => {
    expect(() =>
      new Broadcaster(new MetricsService()).broadcast([event(1)]),
    ).not.toThrow();
  });

  it('전달이 실패해도 예외를 던지지 않고 나머지를 보낸다', () => {
    jest
      .spyOn(broadcaster['logger'], 'error')
      .mockImplementation(() => undefined);
    emit.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    expect(() => broadcaster.broadcast([event(1), event(2)])).not.toThrow();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('전달 실패 수를 메트릭으로 센다', async () => {
    jest
      .spyOn(broadcaster['logger'], 'error')
      .mockImplementation(() => undefined);
    emit.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    broadcaster.broadcast([event(1), event(2), event(3)]);
    expect(
      await readMetric(metrics.registry, 'chat_broadcast_failures_total'),
    ).toBe(1);
  });
});
