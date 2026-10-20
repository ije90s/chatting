import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module';
import { SessionModule } from '../session/session.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [SessionModule, EventModule],
  providers: [ChatGateway],
})
export class RealtimeModule {}
