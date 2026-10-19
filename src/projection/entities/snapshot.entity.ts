import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import type { SessionState } from '../../session/session.reducer';

// 특정 seq 시점의 reducer 결과. messages로 언제든 다시 만들 수 있는 복원 가속용 캐시다.
// state의 CHECK (JSON_VALID)는 마이그레이션에만 있다(TypeORM이 MariaDB CHECK를 지원하지 않음).
@Entity('snapshots')
export class Snapshot {
  @PrimaryColumn({ name: 'session_id', type: 'char', length: 36 })
  sessionId: string;

  @PrimaryColumn({ type: 'bigint', unsigned: true })
  seq: number;

  @Column({ type: 'json' })
  state: SessionState;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @ManyToOne(() => Session, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'fk_snapshots_session',
  })
  session: Session;
}
