import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../event/entities/message.entity';
import { EventModule } from '../event/event.module';
import { ProjectionModule } from '../projection/projection.module';
import { BroadcastModule } from '../realtime/broadcast.module';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';
import { SessionController } from './session.controller';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, Participant, Message]),
    EventModule,
    ProjectionModule,
    BroadcastModule,
  ],
  controllers: [SessionController],
  providers: [SessionService, SessionRepository],
  exports: [SessionService],
})
export class SessionModule {}
