import { EventType } from '../event/event-type';
import { shouldSnapshot } from './snapshot-policy';

describe('shouldSnapshot', () => {
  it.each([
    EventType.PARTICIPANT_JOINED,
    EventType.PARTICIPANT_LEFT,
    EventType.SESSION_ENDED,
  ])('상태를 바꾸는 이벤트(%s)는 seq와 무관하게 기록한다', (type) => {
    expect(shouldSnapshot({ type, seq: 7 })).toBe(true);
  });

  it.each([
    EventType.SESSION_CREATED,
    EventType.MESSAGE_CREATED,
    EventType.PRESENCE_ONLINE,
    EventType.PRESENCE_OFFLINE,
  ])('그 외 이벤트(%s)는 100의 배수가 아니면 기록하지 않는다', (type) => {
    expect(shouldSnapshot({ type, seq: 99 })).toBe(false);
    expect(shouldSnapshot({ type, seq: 101 })).toBe(false);
  });

  it.each([100, 200, 1000])(
    'seq가 100의 배수(%i)면 타입과 무관하게 기록한다',
    (seq) => {
      expect(shouldSnapshot({ type: EventType.MESSAGE_CREATED, seq })).toBe(
        true,
      );
      expect(shouldSnapshot({ type: EventType.PRESENCE_ONLINE, seq })).toBe(
        true,
      );
    },
  );

  it('SESSION_CREATED(seq 1)는 기록하지 않는다', () => {
    expect(shouldSnapshot({ type: EventType.SESSION_CREATED, seq: 1 })).toBe(
      false,
    );
  });
});
