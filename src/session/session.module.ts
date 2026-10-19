import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Participant])],
})
export class SessionModule {}
