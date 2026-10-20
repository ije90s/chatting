import { Injectable } from '@nestjs/common';
import { EventService } from '../event/event.service';
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
