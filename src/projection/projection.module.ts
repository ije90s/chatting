import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Snapshot } from './entities/snapshot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Snapshot])],
})
export class ProjectionModule {}
