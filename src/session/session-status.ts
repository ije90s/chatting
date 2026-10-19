// 엔티티와 reducer가 함께 쓰는 값 정의 (docs/api.md "세션 상태")
export const SessionStatus = {
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  END: 'END',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const Presence = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
} as const;

export type Presence = (typeof Presence)[keyof typeof Presence];

export const MAX_PARTICIPANTS = 2;
