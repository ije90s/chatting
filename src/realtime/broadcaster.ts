import { Injectable, Logger } from '@nestjs/common';
import { Namespace } from 'socket.io';
import { EventDto } from '../event/dto/event.dto';
import type { ServerToClientEvents } from './socket-auth';

export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

type ChatNamespace = Namespace<Record<string, never>, ServerToClientEvents>;

// 커밋된 이벤트를 세션 room에 전달만 한다. 저장이나 중복 판단은 하지 않는다.
// 호출하는 쪽이 커밋 후, 새로 저장된 이벤트(created: true)에 대해서만 부른다.
@Injectable()
export class Broadcaster {
  private readonly logger = new Logger(Broadcaster.name);
  private namespace: ChatNamespace | null = null;

  // ChatGateway가 초기화될 때 /chat namespace를 연결한다.
  attach(namespace: ChatNamespace): void {
    this.namespace = namespace;
  }

  // 이미 커밋된 뒤이므로 실패해도 요청 결과는 바꾸지 않고 로그만 남긴다.
  broadcast(events: EventDto[]): void {
    if (!this.namespace) {
      return;
    }
    for (const event of events) {
      try {
        this.namespace
          .to(sessionRoom(event.sessionId))
          .emit('session:event', event);
      } catch (error) {
        this.logger.error(
          `broadcast 실패: session=${event.sessionId} seq=${event.seq}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
