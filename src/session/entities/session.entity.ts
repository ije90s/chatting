import { Column, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';
import { SessionStatus } from '../session-status';
import { Participant } from './participant.entity';

// 세션 현재 상태 프로젝션. 이벤트 저장과 같은 트랜잭션에서 EventService만 갱신한다.
@Entity('sessions')
@Index('idx_sessions_created', ['createdAt', 'id'])
@Index('idx_sessions_status_created', ['status', 'createdAt', 'id'])
export class Session {
  // UUID v7
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({
    type: 'enum',
    enum: Object.values(SessionStatus),
    default: SessionStatus.JOIN,
  })
  status: SessionStatus;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy: string;

  // seq 발급 카운터. 세션 행을 FOR UPDATE로 잠근 뒤 +1 한다.
  @Column({ name: 'last_seq', type: 'bigint', unsigned: true, default: 0 })
  lastSeq: number;

  // join한 인원(나간 사람 포함). 최대 2.
  @Column({
    name: 'participant_count',
    type: 'tinyint',
    unsigned: true,
    default: 0,
  })
  participantCount: number;

  // 시각은 DB 기본값 대신 이벤트의 receivedAt을 애플리케이션이 넣는다.
  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @Column({ name: 'ended_at', type: 'datetime', precision: 3, nullable: true })
  endedAt: Date | null;

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @OneToMany(() => Participant, (participant) => participant.session)
  participants: Participant[];
}
