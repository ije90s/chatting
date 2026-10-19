import { HttpStatus } from '@nestjs/common';

// docs/api.md "응답 형식"의 에러 코드 목록과 일치시킨다.
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_PARTICIPANT: 'NOT_PARTICIPANT',
  NOT_FOUND: 'NOT_FOUND',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_FULL: 'SESSION_FULL',
  INVALID_SESSION_STATUS: 'INVALID_SESSION_STATUS',
  ALREADY_LEFT: 'ALREADY_LEFT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_DEFINITIONS: Record<
  ErrorCode,
  { status: HttpStatus; message: string }
> = {
  VALIDATION_ERROR: {
    status: HttpStatus.BAD_REQUEST,
    message: '요청 형식이 올바르지 않습니다.',
  },
  UNAUTHORIZED: {
    status: HttpStatus.UNAUTHORIZED,
    message: '사용자 식별 정보가 없습니다.',
  },
  NOT_PARTICIPANT: {
    status: HttpStatus.FORBIDDEN,
    message: '세션 참여자가 아닙니다.',
  },
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '요청한 경로를 찾을 수 없습니다.',
  },
  SESSION_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '세션을 찾을 수 없습니다.',
  },
  SESSION_FULL: {
    status: HttpStatus.CONFLICT,
    message: '참여자가 이미 2명입니다.',
  },
  INVALID_SESSION_STATUS: {
    status: HttpStatus.CONFLICT,
    message: '현재 세션 상태에서 허용되지 않는 요청입니다.',
  },
  ALREADY_LEFT: {
    status: HttpStatus.CONFLICT,
    message: '이미 세션에서 나간 참여자입니다.',
  },
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '서버 내부 오류가 발생했습니다.',
  },
};
