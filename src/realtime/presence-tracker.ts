export interface PresenceKey {
  sessionId: string;
  userId: string;
}

// 세션별·사용자별로 구독 중인 소켓을 센다. 프로세스 메모리에만 두므로 단일 인스턴스 기준이다.
// 첫 구독이면 ONLINE, 마지막 구독이 끝나면(해제 또는 연결 끊김) OFFLINE을 기록하는 판단에 쓴다.
export class PresenceTracker {
  // socketId → (sessionId → userId)
  private readonly subscriptions = new Map<string, Map<string, string>>();
  // `${sessionId}:${userId}` → 구독 중인 소켓 수
  private readonly counts = new Map<string, number>();

  // 이 사용자의 이 세션 첫 구독이면 true. 같은 소켓의 중복 구독은 세지 않는다.
  add(socketId: string, { sessionId, userId }: PresenceKey): boolean {
    const sessions =
      this.subscriptions.get(socketId) ?? new Map<string, string>();
    if (sessions.has(sessionId)) {
      return false;
    }
    sessions.set(sessionId, userId);
    this.subscriptions.set(socketId, sessions);

    const key = keyOf(sessionId, userId);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count === 1;
  }

  // 이 소켓의 구독을 끝낸다. 그 사용자의 마지막 구독이었으면 키를 돌려준다.
  remove(socketId: string, sessionId: string): PresenceKey | null {
    const sessions = this.subscriptions.get(socketId);
    const userId = sessions?.get(sessionId);
    if (!sessions || userId === undefined) {
      return null;
    }
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      this.subscriptions.delete(socketId);
    }

    const key = keyOf(sessionId, userId);
    const count = this.counts.get(key)! - 1;
    if (count > 0) {
      this.counts.set(key, count);
      return null;
    }
    this.counts.delete(key);
    return { sessionId, userId };
  }

  // 연결이 끊긴 소켓의 구독을 모두 끝낸다. 마지막 구독이었던 키만 돌려준다.
  removeSocket(socketId: string): PresenceKey[] {
    const sessionIds = [...(this.subscriptions.get(socketId)?.keys() ?? [])];
    return sessionIds
      .map((sessionId) => this.remove(socketId, sessionId))
      .filter((key): key is PresenceKey => key !== null);
  }
}

function keyOf(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}
