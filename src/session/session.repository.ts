import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Message } from '../event/entities/message.entity';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';
import type { SessionCursor } from './session-cursor';
import { Presence, SessionStatus } from './session-status';

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
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
  ) {}

  findById(id: string) {
    return this.sessions.findOneBy({ id });
  }

  findParticipant(sessionId: string, userId: string) {
    return this.participants.findOneBy({ sessionId, userId });
  }

  findByPresence(presence: Presence) {
    return this.participants.findBy({ presence });
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

  // afterSeq 초과 이벤트를 seq 오름차순으로 (uk_messages_session_seq)
  findEventsAfter(sessionId: string, afterSeq: number, limit: number) {
    return this.messages.find({
      where: { sessionId, seq: MoreThan(afterSeq) },
      order: { seq: 'ASC' },
      take: limit,
    });
  }
}
