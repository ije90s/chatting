import { HttpException } from '@nestjs/common';
import { ERROR_DEFINITIONS, ErrorCode } from './error-code';

// 도메인 에러는 이 예외로 던진다. HTTP 상태는 에러 코드에서 정해진다.
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string = ERROR_DEFINITIONS[code].message,
  ) {
    super(message, ERROR_DEFINITIONS[code].status);
  }
}
