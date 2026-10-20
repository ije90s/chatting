import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [SessionModule],
  providers: [ChatGateway],
})
export class RealtimeModule {}
