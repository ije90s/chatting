import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { EventPayload, EventType } from '../event/event-type';
import { MAX_PARTICIPANTS, Presence, SessionStatus } from './session-status';

// 실시간 처리, 프로젝션 갱신, 타임라인 복원이 함께 쓰는 세션 상태.
// 스냅샷에 JSON으로 그대로 저장하므로 시각은 ISO-8601 문자열로 둔다.
export interface ParticipantState {
  userId: string;
  joinedAt: string;
  leftAt: string | null;
  presence: Presence;
}

export interface LastMessageState {
  seq: number;
  actorId: string;
  content: string;
  receivedAt: string;
}

export interface SessionState {
  // SESSION_CREATED 적용 전에는 null
  status: SessionStatus | null;
  participants: ParticipantState[];
  messageCount: number;
  lastMessage: LastMessageState | null;
}

export interface ReducibleEvent {
  seq: number;
  type: EventType;
  actorId: string;
  payload: EventPayload;
  receivedAt: string;
}

export const initialSessionState: SessionState = {
  status: null,
  participants: [],
  messageCount: 0,
  lastMessage: null,
};

// 순수 함수. 허용되지 않는 전이는 AppException을 던진다. DB나 시계에 접근하지 않는다.
export function reduce(
  state: SessionState,
  event: ReducibleEvent,
): SessionState {
  if (event.type === EventType.SESSION_CREATED) {
    if (state.status !== null) {
      throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
    }
    return { ...initialSessionState, status: SessionStatus.JOIN };
  }
  if (state.status === null) {
    throw new AppException(ErrorCode.SESSION_NOT_FOUND);
  }

  switch (event.type) {
    case EventType.PARTICIPANT_JOINED:
      return join(state, event);
    case EventType.PARTICIPANT_LEFT:
      return leave(state, event);
    case EventType.MESSAGE_CREATED:
      return createMessage(state, event);
    case EventType.PRESENCE_ONLINE:
      return changePresence(state, event, Presence.ONLINE);
    case EventType.PRESENCE_OFFLINE:
      return changePresence(state, event, Presence.OFFLINE);
    case EventType.SESSION_ENDED:
      return end(state, event);
  }
}

// 이미 반영된 요청인지 판단한다. true면 새 이벤트를 만들지 않고 기존 이벤트를 돌려준다(멱등).
export function isAlreadyApplied(
  state: SessionState,
  type: EventType,
  actorId: string,
): boolean {
  const participant = findParticipant(state, actorId);
  switch (type) {
    case EventType.PARTICIPANT_JOINED:
      return participant !== undefined && participant.leftAt === null;
    case EventType.PARTICIPANT_LEFT:
      return participant !== undefined && participant.leftAt !== null;
    case EventType.SESSION_ENDED:
      return (
        state.status === SessionStatus.END &&
        participant !== undefined &&
        participant.leftAt === null
      );
    default:
      return false;
  }
}

export function replay(
  events: ReducibleEvent[],
  from: SessionState = initialSessionState,
): SessionState {
  return events.reduce(reduce, from);
}

function join(state: SessionState, event: ReducibleEvent): SessionState {
  const existing = findParticipant(state, event.actorId);
  // 누군가 나가면 세션이 LEAVE가 되므로, 상태보다 먼저 검사해야 ALREADY_LEFT가 나온다.
  if (existing?.leftAt) {
    throw new AppException(ErrorCode.ALREADY_LEFT);
  }
  if (state.status !== SessionStatus.JOIN) {
    throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
  }
  if (existing) {
    // 이미 참여 중인 경우는 isAlreadyApplied로 먼저 걸러진다.
    throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
  }
  if (state.participants.length >= MAX_PARTICIPANTS) {
    throw new AppException(ErrorCode.SESSION_FULL);
  }
  const participants = [
    ...state.participants,
    {
      userId: event.actorId,
      joinedAt: event.receivedAt,
      leftAt: null,
      presence: Presence.OFFLINE,
    },
  ];
  // 프로젝션 조회 순서(joined_at, user_id)와 같게 정렬해 두 경로의 상태를 일치시킨다.
  participants.sort(
    (a, b) =>
      a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId),
  );
  return { ...state, participants };
}

function leave(state: SessionState, event: ReducibleEvent): SessionState {
  requireActiveParticipant(state, event.actorId);
  if (state.status === SessionStatus.END) {
    throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
  }
  return {
    ...state,
    status: SessionStatus.LEAVE,
    participants: updateParticipant(state, event.actorId, {
      leftAt: event.receivedAt,
    }),
  };
}

function createMessage(
  state: SessionState,
  event: ReducibleEvent,
): SessionState {
  requireActiveParticipant(state, event.actorId);
  if (state.status !== SessionStatus.JOIN) {
    throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
  }
  return {
    ...state,
    messageCount: state.messageCount + 1,
    lastMessage: {
      seq: event.seq,
      actorId: event.actorId,
      content: String(event.payload.content),
      receivedAt: event.receivedAt,
    },
  };
}

// presence는 세션 상태와 무관하다. 나간 참여자의 연결 끊김도 기록할 수 있다.
function changePresence(
  state: SessionState,
  event: ReducibleEvent,
  presence: Presence,
): SessionState {
  if (!findParticipant(state, event.actorId)) {
    throw new AppException(ErrorCode.NOT_PARTICIPANT);
  }
  return {
    ...state,
    participants: updateParticipant(state, event.actorId, { presence }),
  };
}

function end(state: SessionState, event: ReducibleEvent): SessionState {
  const participant = findParticipant(state, event.actorId);
  // docs/api.md: 참여 중인(나가지 않은) 사용자만 종료할 수 있다. 그 외에는 403.
  if (!participant || participant.leftAt !== null) {
    throw new AppException(ErrorCode.NOT_PARTICIPANT);
  }
  if (state.status === SessionStatus.END) {
    throw new AppException(ErrorCode.INVALID_SESSION_STATUS);
  }
  return { ...state, status: SessionStatus.END };
}

function requireActiveParticipant(state: SessionState, actorId: string): void {
  const participant = findParticipant(state, actorId);
  if (!participant) {
    throw new AppException(ErrorCode.NOT_PARTICIPANT);
  }
  if (participant.leftAt !== null) {
    throw new AppException(ErrorCode.ALREADY_LEFT);
  }
}

function findParticipant(
  state: SessionState,
  userId: string,
): ParticipantState | undefined {
  return state.participants.find((p) => p.userId === userId);
}

function updateParticipant(
  state: SessionState,
  userId: string,
  changes: Partial<ParticipantState>,
): ParticipantState[] {
  return state.participants.map((p) =>
    p.userId === userId ? { ...p, ...changes } : p,
  );
}
