import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';

export const USER_ID_HEADER = 'x-user-id';
// participants.user_id 컬럼 길이(VARCHAR(64))
const MAX_USER_ID_LENGTH = 64;

// 헤더 값을 검사해 사용자 ID를 돌려준다. 없거나 비어 있으면 401.
export function extractUserId(value: string | string[] | undefined): string {
  const userId = typeof value === 'string' ? value.trim() : '';
  if (!userId) {
    throw new AppException(ErrorCode.UNAUTHORIZED);
  }
  if (userId.length > MAX_USER_ID_LENGTH) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      `X-User-Id는 ${MAX_USER_ID_LENGTH}자 이하여야 합니다.`,
    );
  }
  return userId;
}

// 임시 사용자 식별: X-User-Id 헤더 (docs/api.md "사용자 식별")
export const UserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    extractUserId(
      context.switchToHttp().getRequest<Request>().headers[USER_ID_HEADER],
    ),
);
