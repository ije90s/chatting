import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
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
import { SessionService } from '../session/session.service';
import { authenticateSocket } from './socket-auth';
import type { ChatSocket } from './socket-auth';

export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

type SubscribeAck = SuccessResponse<{ sessionId: string }> | ErrorResponseDto;

// 수신 전용 채널. 메시지는 받지 않고, 구독과 presence만 다룬다 (docs/api.md "실시간").
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);
  // REST와 같은 규칙으로 예외를 { success: false, code, message }로 바꾼다.
  private readonly errorMapper = new HttpExceptionFilter();

  constructor(private readonly sessionService: SessionService) {}

  afterInit(namespace: Namespace): void {
    namespace.use(authenticateSocket);
  }

  handleConnection(socket: ChatSocket): void {
    this.logger.debug(`connected: ${socket.data.userId} (${socket.id})`);
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
      return { success: true, data: { sessionId } };
    } catch (error) {
      const { body: failure } = this.errorMapper.toErrorResponse(error);
      socket.emit('session:error', failure);
      return failure;
    }
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
