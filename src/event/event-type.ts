// docs/api.md "이벤트 타입"
export const EventType = {
  SESSION_CREATED: 'SESSION_CREATED',
  PARTICIPANT_JOINED: 'PARTICIPANT_JOINED',
  PARTICIPANT_LEFT: 'PARTICIPANT_LEFT',
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  PRESENCE_ONLINE: 'PRESENCE_ONLINE',
  PRESENCE_OFFLINE: 'PRESENCE_OFFLINE',
  SESSION_ENDED: 'SESSION_ENDED',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export type EventPayload = Record<string, unknown>;
