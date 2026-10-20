import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Namespace } from 'socket.io';
import { SuccessResponse } from '../common/interceptors/response.interceptor';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { HttpExceptionFilter } from '../common/errors/http-exception.filter';
import { EventType } from '../event/event-type';
import { EventService } from '../event/event.service';
import { SessionService } from '../session/session.service';
import { PresenceKey, PresenceTracker } from './presence-tracker';
import { authenticateSocket } from './socket-auth';
import type { ChatSocket } from './socket-auth';

export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

type SubscribeAck = SuccessResponse<{ sessionId: string }> | ErrorResponseDto;

type PresenceType =
  typeof EventType.PRESENCE_ONLINE | typeof EventType.PRESENCE_OFFLINE;

// 수신 전용 채널. 메시지는 받지 않고, 구독과 presence만 다룬다 (docs/api.md "실시간").
// presence는 아키텍처 규칙상 Gateway가 EventService를 직접 호출해 저장한다.
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway
  implements
    OnApplicationBootstrap,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);
  // REST와 같은 규칙으로 예외를 { success: false, code, message }로 바꾼다.
  private readonly errorMapper = new HttpExceptionFilter();
  private readonly presence = new PresenceTracker();
  // 같은 사용자·세션의 presence 저장을 호출 순서대로 직렬화한다. 그렇지 않으면 ONLINE과
  // OFFLINE이 거의 동시에 들어올 때 세션 잠금을 얻는 순서가 바뀌어 최종 상태가 뒤집힐 수 있다.
  private readonly presenceQueue = new Map<string, Promise<void>>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly eventService: EventService,
  ) {}

  // 메모리의 연결 정보는 재시작하면 사라진다. 연결을 받기 전에 ONLINE으로 남은 참여자를 OFFLINE으로 기록한다.
  async onApplicationBootstrap(): Promise<void> {
    const online = await this.sessionService.findOnlineParticipants();
    for (const key of online) {
      void this.recordPresence(key, EventType.PRESENCE_OFFLINE);
    }
    await Promise.all(this.presenceQueue.values());
    if (online.length > 0) {
      this.logger.log(`presence 정리: ${online.length}명을 OFFLINE으로 기록`);
    }
  }

  afterInit(namespace: Namespace): void {
    namespace.use(authenticateSocket);
  }

  handleConnection(socket: ChatSocket): void {
    this.logger.debug(`connected: ${socket.data.userId} (${socket.id})`);
  }

  handleDisconnect(socket: ChatSocket): void {
    for (const key of this.presence.removeSocket(socket.id)) {
      void this.recordPresence(key, EventType.PRESENCE_OFFLINE);
    }
  }

  // 참여 기록이 있는 사용자만 room에 들어간다. 결과는 ack로, 실패는 session:error로도 알린다.
  @SubscribeMessage('session:subscribe')
  async subscribe(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    try {
      const sessionId = parseSessionId(body);
      await this.sessionService.requireParticipant(
        sessionId,
        socket.data.userId,
      );
      await socket.join(sessionRoom(sessionId));
      // 권한 확인 중에 연결이 끊겼으면 추적하지 않는다(ONLINE이 남지 않게).
      const key = { sessionId, userId: socket.data.userId };
      if (socket.connected && this.presence.add(socket.id, key)) {
        await this.recordPresence(key, EventType.PRESENCE_ONLINE);
      }
      return { success: true, data: { sessionId } };
    } catch (error) {
      const { body: failure } = this.errorMapper.toErrorResponse(error);
      socket.emit('session:error', failure);
      return failure;
    }
  }

  // 구독하지 않은 세션이어도 성공으로 응답한다.
  @SubscribeMessage('session:unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    try {
      const sessionId = parseSessionId(body);
      await socket.leave(sessionRoom(sessionId));
      const last = this.presence.remove(socket.id, sessionId);
      if (last) {
        await this.recordPresence(last, EventType.PRESENCE_OFFLINE);
      }
      return { success: true, data: { sessionId } };
    } catch (error) {
      const { body: failure } = this.errorMapper.toErrorResponse(error);
      socket.emit('session:error', failure);
      return failure;
    }
  }

  // 실패해도 구독 결과에는 영향을 주지 않고 로그만 남긴다.
  private recordPresence(key: PresenceKey, type: PresenceType): Promise<void> {
    const queueKey = `${key.sessionId}:${key.userId}`;
    const previous = this.presenceQueue.get(queueKey) ?? Promise.resolve();
    const next = previous
      .then(() =>
        this.eventService.append(key.sessionId, {
          type,
          actorId: key.userId,
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          this.logger.error(
            `${type} 저장 실패: session=${key.sessionId} user=${key.userId}`,
            error instanceof Error ? error.stack : String(error),
          );
        },
      )
      .finally(() => {
        if (this.presenceQueue.get(queueKey) === next) {
          this.presenceQueue.delete(queueKey);
        }
      });
    this.presenceQueue.set(queueKey, next);
    return next;
  }
}

function parseSessionId(body: unknown): string {
  const sessionId =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).sessionId
      : undefined;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      'sessionId는 비어 있지 않은 문자열이어야 합니다.',
    );
  }
  return sessionId;
}
