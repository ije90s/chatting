import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Snapshot } from '../projection/entities/snapshot.entity';
import { Participant } from '../session/entities/participant.entity';
import { Session } from '../session/entities/session.entity';
import { Message } from './entities/message.entity';
import { EventType } from './event-type';

// EventService 트랜잭션 안에서 쓰는 쿼리. 모든 메서드는 트랜잭션의 EntityManager를 받는다.
@Injectable()
export class EventRepository {
  // 세션 행을 잠근다. 같은 세션의 쓰기는 여기서 직렬화된다.
  lockSession(manager: EntityManager, sessionId: string) {
    return manager.findOne(Session, {
      where: { id: sessionId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findParticipants(manager: EntityManager, sessionId: string) {
    return manager.find(Participant, {
      where: { sessionId },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });
  }

  findEventBySeq(manager: EntityManager, sessionId: string, seq: number) {
    return manager.findOneBy(Message, { sessionId, seq });
  }

  findEventByClientEventId(
    manager: EntityManager,
    sessionId: string,
    clientEventId: string,
  ) {
    return manager.findOneBy(Message, { sessionId, clientEventId });
  }

  findLatestEvent(
    manager: EntityManager,
    sessionId: string,
    type: EventType,
    actorId?: string,
  ) {
    return manager.findOne(Message, {
      where: actorId ? { sessionId, type, actorId } : { sessionId, type },
      order: { seq: 'DESC' },
    });
  }

  insertSession(manager: EntityManager, session: Session) {
    return manager.insert(Session, session);
  }

  updateSession(
    manager: EntityManager,
    sessionId: string,
    changes: Partial<Session>,
  ) {
    return manager.update(Session, { id: sessionId }, changes);
  }

  upsertParticipant(manager: EntityManager, participant: Partial<Participant>) {
    return manager.upsert(Participant, participant, ['sessionId', 'userId']);
  }

  async insertEvent(
    manager: EntityManager,
    message: Omit<Message, 'id' | 'session'>,
  ): Promise<Message> {
    const result = await manager.insert(
      Message,
      message as QueryDeepPartialEntity<Message>,
    );
    return { ...message, id: Number(result.identifiers[0].id) } as Message;
  }

  insertSnapshot(manager: EntityManager, snapshot: Omit<Snapshot, 'session'>) {
    return manager.insert(Snapshot, snapshot);
  }
}
