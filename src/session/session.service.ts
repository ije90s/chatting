import { Injectable } from '@nestjs/common';
import { EventType } from '../event/event-type';
import { AppendEventResult, EventService } from '../event/event.service';
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
