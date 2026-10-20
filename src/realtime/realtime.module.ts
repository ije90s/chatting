import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module';
import { SessionModule } from '../session/session.module';
import { BroadcastModule } from './broadcast.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [SessionModule, EventModule, BroadcastModule],
  providers: [ChatGateway],
})
export class RealtimeModule {}
