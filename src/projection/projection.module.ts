import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../event/entities/message.entity';
import { Snapshot } from './entities/snapshot.entity';
import { ProjectionRepository } from './projection.repository';
import { ProjectionService } from './projection.service';

// 읽기 전용. 스냅샷 저장은 EventService 트랜잭션에서 한다.
@Module({
  imports: [TypeOrmModule.forFeature([Snapshot, Message])],
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
