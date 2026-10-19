import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { EventPayload, EventType } from '../event/event-type';
import {
  initialSessionState,
  isAlreadyApplied,
  reduce,
  ReducibleEvent,
  replay,
  SessionState,
} from './session.reducer';

let seq = 0;
function event(
  type: EventType,
  actorId: string,
  payload: EventPayload = {},
): ReducibleEvent {
  seq += 1;
  return {
    seq,
    type,
    actorId,
    payload,
    receivedAt: `2026-10-19T06:00:00.${String(seq).padStart(3, '0')}Z`,
  };
}

function expectError(fn: () => unknown, code: ErrorCode) {
  expect(fn).toThrow(AppException);
  expect(fn).toThrow(expect.objectContaining({ code }) as AppException);
}

// SESSION_CREATED + 생성자 user-a 참여
function created(): SessionState {
  seq = 0;
  return replay([
    event(EventType.SESSION_CREATED, 'user-a', { title: '상담' }),
    event(EventType.PARTICIPANT_JOINED, 'user-a'),
  ]);
}

function withTwo(): SessionState {
  return reduce(created(), event(EventType.PARTICIPANT_JOINED, 'user-b'));
}

describe('reduce', () => {
  it('SESSION_CREATED는 빈 상태를 JOIN으로 만든다', () => {
    const state = reduce(
      initialSessionState,
      event(EventType.SESSION_CREATED, 'user-a'),
    );
    expect(state).toEqual({
      status: 'JOIN',
      participants: [],
      messageCount: 0,
      lastMessage: null,
    });
  });

  it('입력 상태를 바꾸지 않는다', () => {
    const state = created();
    const before = structuredClone(state);
    reduce(state, event(EventType.PARTICIPANT_JOINED, 'user-b'));
    reduce(state, event(EventType.MESSAGE_CREATED, 'user-a', { content: 'x' }));
    expect(state).toEqual(before);
  });

  it('SESSION_CREATED를 두 번 적용할 수 없다', () => {
    expectError(
      () => reduce(created(), event(EventType.SESSION_CREATED, 'user-a')),
      ErrorCode.INVALID_SESSION_STATUS,
    );
  });

  it('생성 전 상태에는 다른 이벤트를 적용할 수 없다', () => {
    expectError(
      () =>
        reduce(
          initialSessionState,
          event(EventType.PARTICIPANT_JOINED, 'user-a'),
        ),
      ErrorCode.SESSION_NOT_FOUND,
    );
  });

  describe('PARTICIPANT_JOINED', () => {
    it('참여자를 OFFLINE으로 추가하고 세션 상태는 그대로 둔다', () => {
      const state = withTwo();
      expect(state.status).toBe('JOIN');
      expect(state.participants).toEqual([
        {
          userId: 'user-a',
          joinedAt: '2026-10-19T06:00:00.002Z',
          leftAt: null,
          presence: 'OFFLINE',
        },
        {
          userId: 'user-b',
          joinedAt: '2026-10-19T06:00:00.003Z',
          leftAt: null,
          presence: 'OFFLINE',
        },
      ]);
    });

    it('이미 참여 중인 사용자를 다시 추가하지 않는다', () => {
      expectError(
        () => reduce(withTwo(), event(EventType.PARTICIPANT_JOINED, 'user-b')),
        ErrorCode.INVALID_SESSION_STATUS,
      );
    });

    it('세 번째 참여자는 SESSION_FULL', () => {
      expectError(
        () => reduce(withTwo(), event(EventType.PARTICIPANT_JOINED, 'user-c')),
        ErrorCode.SESSION_FULL,
      );
    });

    it('나간 사용자는 다시 참여할 수 없다 (ALREADY_LEFT)', () => {
      const state = reduce(
        withTwo(),
        event(EventType.PARTICIPANT_LEFT, 'user-b'),
      );
      expectError(
        () => reduce(state, event(EventType.PARTICIPANT_JOINED, 'user-b')),
        ErrorCode.ALREADY_LEFT,
      );
    });

    it.each([
      ['LEAVE', EventType.PARTICIPANT_LEFT],
      ['END', EventType.SESSION_ENDED],
    ])('%s 세션에는 새로 참여할 수 없다', (_status, type) => {
      const state = reduce(created(), event(type, 'user-a'));
      expectError(
        () => reduce(state, event(EventType.PARTICIPANT_JOINED, 'user-b')),
        ErrorCode.INVALID_SESSION_STATUS,
      );
    });
  });

  describe('MESSAGE_CREATED', () => {
    it('메시지 수와 마지막 메시지를 갱신한다', () => {
      let state = withTwo();
      state = reduce(
        state,
        event(EventType.MESSAGE_CREATED, 'user-a', { content: '안녕' }),
      );
      state = reduce(
        state,
        event(EventType.MESSAGE_CREATED, 'user-b', { content: '반가워' }),
      );
      expect(state.messageCount).toBe(2);
      expect(state.lastMessage).toEqual({
        seq: 5,
        actorId: 'user-b',
        content: '반가워',
        receivedAt: '2026-10-19T06:00:00.005Z',
      });
    });

    it('참여자가 아니면 NOT_PARTICIPANT', () => {
      expectError(
        () =>
          reduce(
            created(),
            event(EventType.MESSAGE_CREATED, 'user-x', { content: 'x' }),
          ),
        ErrorCode.NOT_PARTICIPANT,
      );
    });

    it('나간 참여자는 ALREADY_LEFT', () => {
      const state = reduce(
        withTwo(),
        event(EventType.PARTICIPANT_LEFT, 'user-b'),
      );
      expectError(
        () =>
          reduce(
            state,
            event(EventType.MESSAGE_CREATED, 'user-b', { content: 'x' }),
          ),
        ErrorCode.ALREADY_LEFT,
      );
    });

    it.each([
      ['LEAVE', EventType.PARTICIPANT_LEFT, 'user-b'],
      ['END', EventType.SESSION_ENDED, 'user-b'],
    ])('%s 세션에는 보낼 수 없다', (_status, type, actor) => {
      const state = reduce(withTwo(), event(type, actor));
      expectError(
        () =>
          reduce(
            state,
            event(EventType.MESSAGE_CREATED, 'user-a', { content: 'x' }),
          ),
        ErrorCode.INVALID_SESSION_STATUS,
      );
    });
  });

  describe('PARTICIPANT_LEFT', () => {
    it('JOIN 세션을 LEAVE로 바꾸고 leftAt을 기록한다', () => {
      const state = reduce(
        withTwo(),
        event(EventType.PARTICIPANT_LEFT, 'user-b'),
      );
      expect(state.status).toBe('LEAVE');
      expect(state.participants[1].leftAt).toBe('2026-10-19T06:00:00.004Z');
      expect(state.participants[0].leftAt).toBeNull();
    });

    it('LEAVE 세션에서 남은 참여자도 나갈 수 있다', () => {
      let state = reduce(
        withTwo(),
        event(EventType.PARTICIPANT_LEFT, 'user-b'),
      );
      state = reduce(state, event(EventType.PARTICIPANT_LEFT, 'user-a'));
      expect(state.status).toBe('LEAVE');
      expect(state.participants.every((p) => p.leftAt !== null)).toBe(true);
    });

    it('END 세션에서는 나갈 수 없다', () => {
      const state = reduce(withTwo(), event(EventType.SESSION_ENDED, 'user-a'));
      expectError(
        () => reduce(state, event(EventType.PARTICIPANT_LEFT, 'user-b')),
        ErrorCode.INVALID_SESSION_STATUS,
      );
    });

    it('참여자가 아니면 NOT_PARTICIPANT', () => {
      expectError(
        () => reduce(created(), event(EventType.PARTICIPANT_LEFT, 'user-x')),
        ErrorCode.NOT_PARTICIPANT,
      );
    });
  });

  describe('SESSION_ENDED', () => {
    it.each([
      ['JOIN', [] as ReducibleEvent[]],
      ['LEAVE', [event(EventType.PARTICIPANT_LEFT, 'user-b')]],
    ])('%s 세션을 END로 바꾼다', (_status, before) => {
      const state = replay(
        before.map((e) => ({ ...e, seq: 100 })),
        withTwo(),
      );
      expect(
        reduce(state, event(EventType.SESSION_ENDED, 'user-a')).status,
      ).toBe('END');
    });

    it('END 세션을 다시 종료할 수 없다', () => {
      const state = reduce(withTwo(), event(EventType.SESSION_ENDED, 'user-a'));
      expectError(
        () => reduce(state, event(EventType.SESSION_ENDED, 'user-b')),
        ErrorCode.INVALID_SESSION_STATUS,
      );
    });

    it('나간 참여자나 참여자가 아닌 사용자는 NOT_PARTICIPANT', () => {
      const state = reduce(
        withTwo(),
        event(EventType.PARTICIPANT_LEFT, 'user-b'),
      );
      for (const actor of ['user-b', 'user-x']) {
        expectError(
          () => reduce(state, event(EventType.SESSION_ENDED, actor)),
          ErrorCode.NOT_PARTICIPANT,
        );
      }
    });
  });

  describe('PRESENCE', () => {
    it('참여자의 presence만 바꾸고 세션 상태는 그대로 둔다', () => {
      let state = withTwo();
      state = reduce(state, event(EventType.PRESENCE_ONLINE, 'user-b'));
      expect(state.status).toBe('JOIN');
      expect(state.participants.map((p) => p.presence)).toEqual([
        'OFFLINE',
        'ONLINE',
      ]);
      state = reduce(state, event(EventType.PRESENCE_OFFLINE, 'user-b'));
      expect(state.participants[1].presence).toBe('OFFLINE');
    });

    it('END 세션이나 나간 참여자도 presence를 기록할 수 있다', () => {
      let state = reduce(withTwo(), event(EventType.PRESENCE_ONLINE, 'user-b'));
      state = reduce(state, event(EventType.PARTICIPANT_LEFT, 'user-b'));
      state = reduce(state, event(EventType.SESSION_ENDED, 'user-a'));
      state = reduce(state, event(EventType.PRESENCE_OFFLINE, 'user-b'));
      expect(state.participants[1].presence).toBe('OFFLINE');
    });

    it('참여자가 아니면 NOT_PARTICIPANT', () => {
      expectError(
        () => reduce(created(), event(EventType.PRESENCE_ONLINE, 'user-x')),
        ErrorCode.NOT_PARTICIPANT,
      );
    });
  });
});

describe('isAlreadyApplied', () => {
  it('참여 중인 사용자의 join은 이미 반영된 요청이다', () => {
    const state = withTwo();
    expect(
      isAlreadyApplied(state, EventType.PARTICIPANT_JOINED, 'user-b'),
    ).toBe(true);
    expect(
      isAlreadyApplied(state, EventType.PARTICIPANT_JOINED, 'user-c'),
    ).toBe(false);
  });

  it('이미 나간 사용자의 leave는 이미 반영된 요청이다', () => {
    const state = reduce(
      withTwo(),
      event(EventType.PARTICIPANT_LEFT, 'user-b'),
    );
    expect(isAlreadyApplied(state, EventType.PARTICIPANT_LEFT, 'user-b')).toBe(
      true,
    );
    expect(isAlreadyApplied(state, EventType.PARTICIPANT_LEFT, 'user-a')).toBe(
      false,
    );
    // 나간 사용자의 join은 멱등이 아니라 ALREADY_LEFT 대상
    expect(
      isAlreadyApplied(state, EventType.PARTICIPANT_JOINED, 'user-b'),
    ).toBe(false);
  });

  it('END 세션의 end는 참여 중인 사용자에게만 이미 반영된 요청이다', () => {
    let state = reduce(withTwo(), event(EventType.PARTICIPANT_LEFT, 'user-b'));
    expect(isAlreadyApplied(state, EventType.SESSION_ENDED, 'user-a')).toBe(
      false,
    );
    state = reduce(state, event(EventType.SESSION_ENDED, 'user-a'));
    expect(isAlreadyApplied(state, EventType.SESSION_ENDED, 'user-a')).toBe(
      true,
    );
    expect(isAlreadyApplied(state, EventType.SESSION_ENDED, 'user-b')).toBe(
      false,
    );
    expect(isAlreadyApplied(state, EventType.SESSION_ENDED, 'user-x')).toBe(
      false,
    );
  });

  it('메시지와 presence는 상태로 중복을 판단하지 않는다', () => {
    const state = withTwo();
    expect(isAlreadyApplied(state, EventType.MESSAGE_CREATED, 'user-a')).toBe(
      false,
    );
    expect(isAlreadyApplied(state, EventType.PRESENCE_ONLINE, 'user-a')).toBe(
      false,
    );
  });
});
