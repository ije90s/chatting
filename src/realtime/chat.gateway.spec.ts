/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { EventType } from '../event/event-type';
import { EventService } from '../event/event.service';
import { SessionService } from '../session/session.service';
import { Broadcaster } from './broadcaster';
import { ChatGateway } from './chat.gateway';
import { SessionQueue } from './session-queue';
import type { ChatSocket } from './socket-auth';
import { MetricsService } from '../metrics/metrics.service';
import { readMetric } from '../metrics/read-metric';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';

describe('ChatGateway 구독', () => {
  let gateway: ChatGateway;
  let sessionService: jest.Mocked<SessionService>;
  let eventService: jest.Mocked<EventService>;
  let broadcaster: jest.Mocked<Broadcaster>;
  let queue: SessionQueue;
  let socket: jest.Mocked<ChatSocket>;

  beforeEach(() => {
    sessionService = {
      requireParticipant: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SessionService>;
    eventService = {
      append: jest.fn().mockResolvedValue({ event: {}, created: true }),
    } as unknown as jest.Mocked<EventService>;
    broadcaster = {
      attach: jest.fn(),
      broadcast: jest.fn(),
    } as unknown as jest.Mocked<Broadcaster>;
    queue = new SessionQueue(new MetricsService());
    socket = {
      id: 'socket-1',
      connected: true,
      data: { userId: 'user-a' },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as unknown as jest.Mocked<ChatSocket>;
    gateway = new ChatGateway(
      sessionService,
      eventService,
      broadcaster,
      queue,
      new MetricsService(),
    );
  });

  it('참여자면 session:{id} room에 넣고 성공 ack를 돌려준다', async () => {
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({ success: true, data: { sessionId: SESSION_ID } });
    expect(sessionService.requireParticipant).toHaveBeenCalledWith(
      SESSION_ID,
      'user-a',
    );
    expect(socket.join).toHaveBeenCalledWith(`session:${SESSION_ID}`);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('권한이 없으면 room에 넣지 않고 session:error와 ack로 알린다', async () => {
    sessionService.requireParticipant.mockRejectedValue(
      new AppException(ErrorCode.NOT_PARTICIPANT),
    );
    const failure = {
      success: false,
      code: 'NOT_PARTICIPANT',
      message: '세션 참여자가 아닙니다.',
    };
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual(failure);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('session:error', failure);
  });

  it.each([
    ['payload 없음', undefined],
    ['sessionId 없음', {}],
    ['빈 sessionId', { sessionId: '' }],
    ['문자열이 아닌 sessionId', { sessionId: 1 }],
  ])('%s은 VALIDATION_ERROR', async (_name, body) => {
    await expect(gateway.subscribe(socket, body)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    expect(sessionService.requireParticipant).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'session:error',
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('알 수 없는 에러는 내부 정보를 숨기고 INTERNAL_ERROR', async () => {
    sessionService.requireParticipant.mockRejectedValue(
      new Error('db password leaked'),
    );
    jest
      .spyOn(gateway['errorMapper']['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    });
  });

  it('구독 해제는 room에서 빼고 성공 ack를 돌려준다', async () => {
    await expect(
      gateway.unsubscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({ success: true, data: { sessionId: SESSION_ID } });
    expect(socket.leave).toHaveBeenCalledWith(`session:${SESSION_ID}`);
  });

  it('구독 해제도 sessionId가 없으면 VALIDATION_ERROR', async () => {
    await expect(gateway.unsubscribe(socket, {})).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

describe('ChatGateway presence', () => {
  let gateway: ChatGateway;
  let sessionService: jest.Mocked<SessionService>;
  let eventService: jest.Mocked<EventService>;
  let broadcaster: jest.Mocked<Broadcaster>;
  let queue: SessionQueue;

  function socketOf(id: string, userId = 'user-a'): ChatSocket {
    return {
      id,
      connected: true,
      data: { userId },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as unknown as ChatSocket;
  }

  function presenceCalls() {
    return eventService.append.mock.calls.map(([sessionId, input]) => [
      sessionId,
      input.type,
      input.actorId,
    ]);
  }

  beforeEach(() => {
    sessionService = {
      requireParticipant: jest.fn().mockResolvedValue(undefined),
      findOnlineParticipants: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SessionService>;
    eventService = {
      append: jest.fn().mockResolvedValue({ event: {}, created: true }),
    } as unknown as jest.Mocked<EventService>;
    broadcaster = {
      attach: jest.fn(),
      broadcast: jest.fn(),
    } as unknown as jest.Mocked<Broadcaster>;
    queue = new SessionQueue(new MetricsService());
    gateway = new ChatGateway(
      sessionService,
      eventService,
      broadcaster,
      queue,
      new MetricsService(),
    );
  });

  it('첫 구독에서만 PRESENCE_ONLINE을 저장한다(여러 탭)', async () => {
    await gateway.subscribe(socketOf('tab-1'), { sessionId: SESSION_ID });
    await gateway.subscribe(socketOf('tab-2'), { sessionId: SESSION_ID });
    await gateway.subscribe(socketOf('tab-2'), { sessionId: SESSION_ID });

    expect(presenceCalls()).toEqual([
      [SESSION_ID, EventType.PRESENCE_ONLINE, 'user-a'],
    ]);
    expect(eventService.append.mock.calls[0][1]).toEqual({
      type: EventType.PRESENCE_ONLINE,
      actorId: 'user-a',
    });
  });

  it('구독 해제와 연결 끊김 모두, 마지막 구독이 끝날 때 PRESENCE_OFFLINE을 저장한다', async () => {
    const tab1 = socketOf('tab-1');
    const tab2 = socketOf('tab-2');
    await gateway.subscribe(tab1, { sessionId: SESSION_ID });
    await gateway.subscribe(tab2, { sessionId: SESSION_ID });

    await gateway.unsubscribe(tab1, { sessionId: SESSION_ID });
    expect(presenceCalls()).toHaveLength(1);

    gateway.handleDisconnect(tab2);
    await queue.idle();
    expect(presenceCalls()).toEqual([
      [SESSION_ID, EventType.PRESENCE_ONLINE, 'user-a'],
      [SESSION_ID, EventType.PRESENCE_OFFLINE, 'user-a'],
    ]);
  });

  it('구독하지 않은 세션의 해제와 구독 없이 끊긴 연결은 저장하지 않는다', async () => {
    await gateway.unsubscribe(socketOf('tab-1'), { sessionId: SESSION_ID });
    gateway.handleDisconnect(socketOf('tab-2'));
    expect(eventService.append).not.toHaveBeenCalled();
  });

  it('권한 확인 중에 연결이 끊기면 추적하지 않는다', async () => {
    const socket = socketOf('tab-1');
    sessionService.requireParticipant.mockImplementation(() => {
      gateway.handleDisconnect(socket);
      (socket as { connected: boolean }).connected = false;
      return Promise.resolve();
    });
    await gateway.subscribe(socket, { sessionId: SESSION_ID });
    expect(eventService.append).not.toHaveBeenCalled();
  });

  it('권한이 없으면 presence를 저장하지 않는다', async () => {
    sessionService.requireParticipant.mockRejectedValue(
      new AppException(ErrorCode.NOT_PARTICIPANT),
    );
    await gateway.subscribe(socketOf('tab-1'), { sessionId: SESSION_ID });
    expect(eventService.append).not.toHaveBeenCalled();
  });

  it('같은 세션의 presence 저장은 호출 순서대로 하나씩 실행한다', async () => {
    let finishOnline!: () => void;
    const order: string[] = [];
    eventService.append.mockImplementation((_sessionId, input) => {
      order.push(`start ${input.type}`);
      if (input.type === EventType.PRESENCE_ONLINE) {
        return new Promise((resolve) => {
          finishOnline = () => {
            order.push(`end ${input.type}`);
            resolve({ event: {} as never, created: true });
          };
        });
      }
      order.push(`end ${input.type}`);
      return Promise.resolve({ event: {} as never, created: true });
    });

    const socket = socketOf('tab-1');
    const subscribing = gateway.subscribe(socket, { sessionId: SESSION_ID });
    await new Promise(setImmediate);
    gateway.handleDisconnect(socket);
    await new Promise(setImmediate);
    // ONLINE이 끝나기 전에는 OFFLINE을 시작하지 않는다.
    expect(order).toEqual(['start PRESENCE_ONLINE']);

    finishOnline();
    await subscribing;
    await queue.idle();
    expect(order).toEqual([
      'start PRESENCE_ONLINE',
      'end PRESENCE_ONLINE',
      'start PRESENCE_OFFLINE',
      'end PRESENCE_OFFLINE',
    ]);
  });

  it('presence 저장이 실패해도 구독은 성공하고 로그만 남긴다', async () => {
    eventService.append.mockRejectedValue(new Error('db down'));
    const logError = jest
      .spyOn(gateway['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(
      gateway.subscribe(socketOf('tab-1'), { sessionId: SESSION_ID }),
    ).resolves.toMatchObject({ success: true });
    expect(logError).toHaveBeenCalled();
  });

  it('저장된 presence 이벤트는 커밋 후 전달하고, 새로 저장되지 않았으면 전달하지 않는다', async () => {
    const online = { sessionId: SESSION_ID, seq: 3 };
    eventService.append.mockResolvedValueOnce({
      event: online as never,
      created: true,
    });
    const socket = socketOf('tab-1');
    await gateway.subscribe(socket, { sessionId: SESSION_ID });
    expect(broadcaster.broadcast).toHaveBeenCalledWith([online]);

    eventService.append.mockResolvedValueOnce({
      event: {} as never,
      created: false,
    });
    await gateway.unsubscribe(socket, { sessionId: SESSION_ID });
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
  });

  it('presence 저장이 실패하면 전달하지 않는다', async () => {
    eventService.append.mockRejectedValue(new Error('db down'));
    jest.spyOn(gateway['logger'], 'error').mockImplementation(() => undefined);
    await gateway.subscribe(socketOf('tab-1'), { sessionId: SESSION_ID });
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('시작할 때 ONLINE으로 남은 참여자를 PRESENCE_OFFLINE으로 기록한다', async () => {
    sessionService.findOnlineParticipants.mockResolvedValue([
      { sessionId: SESSION_ID, userId: 'user-a' },
      { sessionId: SESSION_ID, userId: 'user-b' },
    ]);
    jest.spyOn(gateway['logger'], 'log').mockImplementation(() => undefined);
    await gateway.onApplicationBootstrap();
    expect(presenceCalls()).toEqual([
      [SESSION_ID, EventType.PRESENCE_OFFLINE, 'user-a'],
      [SESSION_ID, EventType.PRESENCE_OFFLINE, 'user-b'],
    ]);
  });
});

describe('ChatGateway 메트릭', () => {
  let gateway: ChatGateway;
  let eventService: jest.Mocked<EventService>;
  let metrics: MetricsService;

  const socket = (id: string) =>
    ({
      id,
      connected: true,
      data: { userId: 'user-a' },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    }) as unknown as ChatSocket;

  beforeEach(() => {
    metrics = new MetricsService();
    eventService = {
      append: jest.fn().mockResolvedValue({ event: {}, created: true }),
    } as unknown as jest.Mocked<EventService>;
    gateway = new ChatGateway(
      {
        requireParticipant: jest.fn().mockResolvedValue(undefined),
      } as unknown as SessionService,
      eventService,
      { broadcast: jest.fn() } as unknown as Broadcaster,
      new SessionQueue(metrics),
      metrics,
    );
  });

  it('연결되면 늘리고 끊기면 줄여 현재 연결 수를 보여 준다', async () => {
    const connections = () =>
      readMetric(metrics.registry, 'chat_socket_connections');
    gateway.handleConnection(socket('s1'));
    gateway.handleConnection(socket('s2'));
    expect(await connections()).toBe(2);

    gateway.handleDisconnect(socket('s1'));
    expect(await connections()).toBe(1);
  });

  it('presence 저장 결과를 이벤트 타입별로 센다', async () => {
    const s1 = socket('s1');
    await gateway.subscribe(s1, { sessionId: SESSION_ID });
    eventService.append.mockRejectedValueOnce(
      new AppException(ErrorCode.NOT_PARTICIPANT),
    );
    await gateway.unsubscribe(s1, { sessionId: SESSION_ID });

    expect(
      await readMetric(metrics.registry, 'chat_event_appends_total', {
        type: EventType.PRESENCE_ONLINE,
        result: 'created',
      }),
    ).toBe(1);
    expect(
      await readMetric(metrics.registry, 'chat_event_appends_total', {
        type: EventType.PRESENCE_OFFLINE,
        result: 'rejected',
      }),
    ).toBe(1);
  });
});
