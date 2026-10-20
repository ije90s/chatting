import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';

// 읽기 전용. sessions, participants 쓰기는 EventService 트랜잭션에서 한다.
@Injectable()
export class SessionRepository {
  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
  ) {}

  findById(id: string) {
    return this.sessions.findOneBy({ id });
  }

  // reducer 상태와 같은 순서(joined_at, user_id)
  findParticipants(sessionId: string) {
    return this.participants.find({
      where: { sessionId },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });
  }
}
