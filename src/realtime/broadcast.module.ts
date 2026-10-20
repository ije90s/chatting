import { Module } from '@nestjs/common';
import { Broadcaster } from './broadcaster';
import { SessionQueue } from './session-queue';

// SessionModule과 RealtimeModule이 함께 쓴다. RealtimeModule이 SessionModule을 가져오므로 순환을 피하려고 분리한다.
@Module({
  providers: [Broadcaster, SessionQueue],
  exports: [Broadcaster, SessionQueue],
})
export class BroadcastModule {}
