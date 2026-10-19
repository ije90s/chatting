import { EventType } from '../event/event-type';

export const SNAPSHOT_INTERVAL = 100;

// 세션/참여 상태를 바꾸는 이벤트. SESSION_CREATED는 빈 상태와 거의 같아 제외한다.
const STATE_CHANGING_EVENTS: ReadonlySet<EventType> = new Set([
  EventType.PARTICIPANT_JOINED,
  EventType.PARTICIPANT_LEFT,
  EventType.SESSION_ENDED,
]);

// 이 이벤트를 저장한 직후 스냅샷을 기록할지 정한다 (docs/db.md "snapshots 기록 시점").
export function shouldSnapshot(event: { type: EventType; seq: number }) {
  return (
    STATE_CHANGING_EVENTS.has(event.type) || event.seq % SNAPSHOT_INTERVAL === 0
  );
}
