import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Presence } from '../session-status';
import { Session } from './session.entity';

// 참여자별 현재 상태 프로젝션. presence도 여기서 관리한다.
@Entity('participants')
@Index('idx_participants_user', ['userId', 'sessionId'])
export class Participant {
  @PrimaryColumn({ name: 'session_id', type: 'char', length: 36 })
  sessionId: string;

  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 64 })
  userId: string;

  @Column({ name: 'joined_at', type: 'datetime', precision: 3 })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'datetime', precision: 3, nullable: true })
  leftAt: Date | null;

  @Column({
    type: 'enum',
    enum: Object.values(Presence),
    default: Presence.OFFLINE,
  })
  presence: Presence;

  @Column({
    name: 'presence_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  presenceAt: Date | null;

  @ManyToOne(() => Session, (session) => session.participants, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'fk_participants_session',
  })
  session: Session;
}
