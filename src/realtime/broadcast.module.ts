import { Module } from '@nestjs/common';
import { Broadcaster } from './broadcaster';

// SessionModule과 RealtimeModule이 함께 쓴다. RealtimeModule이 SessionModule을 가져오므로 순환을 피하려고 분리한다.
@Module({
  providers: [Broadcaster],
  exports: [Broadcaster],
})
export class BroadcastModule {}
