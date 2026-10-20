import { Injectable } from '@nestjs/common';
import { EventType } from '../event/event-type';
import { AppendEventResult, EventService } from '../event/event.service';
import { AppendEventDto } from './dto/append-event.dto';
import { SessionDto } from './dto/session.dto';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionService {
  constructor(
    private readonly eventService: EventService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  // 저장은 EventService가 하고, 응답은 커밋된 프로젝션에서 만든다.
  async create(userId: string, title: string): Promise<SessionDto> {
    const [created] = await this.eventService.createSession({
      title,
      actorId: userId,
    });
    return this.findOne(created.sessionId);
  }

  // 이미 참여 중이면 기존 PARTICIPANT_JOINED 이벤트를 돌려준다(created: false).
  join(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: userId,
    });
  }

  // 이미 END면 기존 SESSION_ENDED 이벤트를 돌려준다(created: false). 다른 참여자가 종료했어도 같다.
  end(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: userId,
    });
  }

  // 메시지, 나가기. 같은 clientEventId나 이미 나간 사용자의 나가기는 기존 이벤트를 돌려준다(created: false).
  appendEvent(
    sessionId: string,
    userId: string,
    body: AppendEventDto,
  ): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: body.type,
      actorId: userId,
      clientEventId: body.clientEventId,
      payload:
        body.type === EventType.MESSAGE_CREATED
          ? { content: body.payload!.content }
          : {},
      clientSentAt: body.clientSentAt ? new Date(body.clientSentAt) : null,
    });
  }

  private async findOne(sessionId: string): Promise<SessionDto> {
    const [session, participants] = await Promise.all([
      this.sessionRepository.findById(sessionId),
      this.sessionRepository.findParticipants(sessionId),
    ]);
    if (!session) {
      throw new Error(`저장한 세션을 찾을 수 없습니다: session=${sessionId}`);
    }
    return SessionDto.from(session, participants);
  }
}
