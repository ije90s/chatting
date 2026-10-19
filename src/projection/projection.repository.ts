import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import { Message } from '../event/entities/message.entity';
import { Snapshot } from './entities/snapshot.entity';

@Injectable()
export class ProjectionRepository {
  constructor(
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(Snapshot)
    private readonly snapshots: Repository<Snapshot>,
  ) {}

  // receivedAt ≤ at인 이벤트 중 가장 큰 seq. 없으면 null
  async findLastSeqAt(sessionId: string, at: Date): Promise<number | null> {
    const row = await this.messages
      .createQueryBuilder('m')
      .select('MAX(m.seq)', 'seq')
      .where('m.session_id = :sessionId', { sessionId })
      .andWhere('m.received_at <= :at', { at })
      .getRawOne<{ seq: number | string | null }>();
    return row?.seq == null ? null : Number(row.seq);
  }

  findLatestSnapshot(sessionId: string, maxSeq: number) {
    return this.snapshots.findOne({
      where: { sessionId, seq: LessThanOrEqual(maxSeq) },
      order: { seq: 'DESC' },
    });
  }

  // fromSeq 초과, toSeq 이하의 이벤트를 seq 순으로
  findEvents(sessionId: string, fromSeq: number, toSeq: number) {
    return this.messages.find({
      where: { sessionId, seq: Between(fromSeq + 1, toSeq) },
      order: { seq: 'ASC' },
    });
  }
}
