import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';
import type { SessionCursor } from './session-cursor';
import { SessionStatus } from './session-status';

export interface SessionListFilter {
  statuses?: SessionStatus[];
  participantId?: string;
  from?: Date;
  to?: Date;
  cursor?: SessionCursor;
  limit: number;
}

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

  // createdAt DESC, id DESC. 커서보다 뒤에 있는 행만 (idx_sessions_created, idx_sessions_status_created)
  findPage(filter: SessionListFilter) {
    const query = this.sessions
      .createQueryBuilder('s')
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .limit(filter.limit);
    if (filter.statuses) {
      query.andWhere('s.status IN (:...statuses)', {
        statuses: filter.statuses,
      });
    }
    if (filter.participantId) {
      // 나간 참여자도 포함한다 (idx_participants_user)
      query.innerJoin(
        Participant,
        'p',
        'p.session_id = s.id AND p.user_id = :participantId',
        { participantId: filter.participantId },
      );
    }
    if (filter.from) {
      query.andWhere('s.created_at >= :from', { from: filter.from });
    }
    if (filter.to) {
      query.andWhere('s.created_at < :to', { to: filter.to });
    }
    if (filter.cursor) {
      query.andWhere(
        '(s.created_at < :cursorAt OR (s.created_at = :cursorAt AND s.id < :cursorId))',
        { cursorAt: filter.cursor.createdAt, cursorId: filter.cursor.id },
      );
    }
    return query.getMany();
  }

  findParticipantsOf(sessionIds: string[]) {
    return this.participants.find({
      where: { sessionId: In(sessionIds) },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });
  }
}
