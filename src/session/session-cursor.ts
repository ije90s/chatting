import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';

// GET /sessions 커서. 정렬 키(createdAt DESC, id DESC)의 마지막 값을 base64url JSON으로 담는다.
export interface SessionCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: SessionCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

// 형식이 잘못된 커서는 400 VALIDATION_ERROR
export function decodeCursor(value: string): SessionCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (typeof parsed === 'object' && parsed !== null) {
      const { createdAt, id } = parsed as Record<string, unknown>;
      const date = typeof createdAt === 'string' ? new Date(createdAt) : null;
      if (date && !isNaN(date.getTime()) && typeof id === 'string' && id) {
        return { createdAt: date, id };
      }
    }
  } catch {
    // 아래에서 같은 에러로 던진다.
  }
  throw new AppException(
    ErrorCode.VALIDATION_ERROR,
    'cursor가 올바르지 않습니다.',
  );
}
