import { PresenceTracker } from './presence-tracker';

const A = { sessionId: 's1', userId: 'user-a' };

describe('PresenceTracker', () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    tracker = new PresenceTracker();
  });

  it('사용자의 세션 첫 구독만 true', () => {
    expect(tracker.add('socket-1', A)).toBe(true);
    expect(tracker.add('socket-2', A)).toBe(false);
    // 다른 사용자, 다른 세션은 따로 센다.
    expect(tracker.add('socket-3', { ...A, userId: 'user-b' })).toBe(true);
    expect(tracker.add('socket-1', { ...A, sessionId: 's2' })).toBe(true);
  });

  it('같은 소켓의 중복 구독은 세지 않는다', () => {
    tracker.add('socket-1', A);
    expect(tracker.add('socket-1', A)).toBe(false);
    expect(tracker.remove('socket-1', 's1')).toEqual(A);
  });

  it('마지막 구독이 끝날 때만 키를 돌려준다', () => {
    tracker.add('socket-1', A);
    tracker.add('socket-2', A);
    expect(tracker.remove('socket-1', 's1')).toBeNull();
    expect(tracker.remove('socket-2', 's1')).toEqual(A);
    // 다시 구독하면 첫 구독이다.
    expect(tracker.add('socket-1', A)).toBe(true);
  });

  it('구독하지 않은 소켓·세션의 해제는 null', () => {
    expect(tracker.remove('socket-1', 's1')).toBeNull();
    tracker.add('socket-1', A);
    expect(tracker.remove('socket-1', 's2')).toBeNull();
    expect(tracker.remove('socket-2', 's1')).toBeNull();
  });

  it('연결이 끊기면 그 소켓의 구독을 모두 끝내고 마지막이었던 키만 돌려준다', () => {
    tracker.add('socket-1', A);
    tracker.add('socket-1', { ...A, sessionId: 's2' });
    tracker.add('socket-2', { ...A, sessionId: 's2' });

    expect(tracker.removeSocket('socket-1')).toEqual([A]);
    expect(tracker.removeSocket('socket-1')).toEqual([]);
    expect(tracker.removeSocket('socket-2')).toEqual([
      { ...A, sessionId: 's2' },
    ]);
  });
});
