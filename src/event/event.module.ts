import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Snapshot } from '../projection/entities/snapshot.entity';
import { Participant } from '../session/entities/participant.entity';
import { Session } from '../session/entities/session.entity';
import { Message } from './entities/message.entity';
import { EventRepository } from './event.repository';
import { EventService } from './event.service';

// 프로젝션(sessions, participants, snapshots)도 이 모듈이 쓴다. 쓰기 경로가 EventService 하나이기 때문이다.
@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Session, Participant, Snapshot]),
  ],
  providers: [EventService, EventRepository],
  exports: [EventService],
})
export class EventModule {}
