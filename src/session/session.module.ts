import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventModule } from '../event/event.module';
import { Participant } from './entities/participant.entity';
import { Session } from './entities/session.entity';
import { SessionController } from './session.controller';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Participant]), EventModule],
  controllers: [SessionController],
  providers: [SessionService, SessionRepository],
})
export class SessionModule {}
