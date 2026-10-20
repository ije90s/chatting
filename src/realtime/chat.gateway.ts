import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Namespace } from 'socket.io';
import { authenticateSocket, ChatSocket } from './socket-auth';

// 수신 전용 채널. 메시지는 받지 않고, 구독과 presence만 다룬다 (docs/api.md "실시간").
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  afterInit(namespace: Namespace): void {
    namespace.use(authenticateSocket);
  }

  handleConnection(socket: ChatSocket): void {
    this.logger.debug(`connected: ${socket.data.userId} (${socket.id})`);
  }
}
