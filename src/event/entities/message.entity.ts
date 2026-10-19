import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import type { EventPayload, EventType } from '../event-type';

// 이벤트 로그(채팅 + 시스템 메시지). append-only: UPDATE/DELETE하지 않는다.
// payload의 CHECK (JSON_VALID)는 마이그레이션에만 있다(TypeORM이 MariaDB CHECK를 지원하지 않음).
@Entity('messages')
@Index('uk_messages_session_seq', ['sessionId', 'seq'], { unique: true })
@Index('uk_messages_session_client_event', ['sessionId', 'clientEventId'], {
  unique: true,
})
@Index('idx_messages_session_received', ['sessionId', 'receivedAt'])
export class Message {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'session_id', type: 'char', length: 36 })
  sessionId: string;

  @Column({ type: 'bigint', unsigned: true })
  seq: number;

  @Column({ type: 'varchar', length: 32 })
  type: EventType;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId: string;

  // presence 등 서버가 만든 이벤트는 NULL
  @Column({
    name: 'client_event_id',
    type: 'char',
    length: 36,
    nullable: true,
  })
  clientEventId: string | null;

  @Column({ type: 'json', default: () => "'{}'" })
  payload: EventPayload;

  @Column({
    name: 'client_sent_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  clientSentAt: Date | null;

  @Column({ name: 'received_at', type: 'datetime', precision: 3 })
  receivedAt: Date;

  @ManyToOne(() => Session, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'fk_messages_session',
  })
  session: Session;
}
