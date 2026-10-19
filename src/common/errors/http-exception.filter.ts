import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { AppException } from './app.exception';
import { ERROR_DEFINITIONS, ErrorCode } from './error-code';

// 모든 예외를 { success: false, code, message } 형식으로 바꾼다.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toErrorResponse(exception);
    response.status(status).json(body);
  }

  toErrorResponse(exception: unknown): {
    status: number;
    body: ErrorResponseDto;
  } {
    if (exception instanceof AppException) {
      return this.build(
        exception.getStatus(),
        exception.code,
        exception.message,
      );
    }

    // 프레임워크가 던진 예외(잘못된 JSON 본문, 없는 경로 등)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        const code = this.codeForClientError(status);
        return this.build(status, code, ERROR_DEFINITIONS[code].message);
      }
    }

    this.logger.error(exception);
    const { status, message } = ERROR_DEFINITIONS.INTERNAL_ERROR;
    return this.build(status, ErrorCode.INTERNAL_ERROR, message);
  }

  private codeForClientError(status: number): ErrorCode {
    if (status === Number(HttpStatus.UNAUTHORIZED)) {
      return ErrorCode.UNAUTHORIZED;
    }
    if (status === Number(HttpStatus.NOT_FOUND)) {
      return ErrorCode.NOT_FOUND;
    }
    return ErrorCode.VALIDATION_ERROR;
  }

  private build(status: number, code: ErrorCode, message: string) {
    return { status, body: { success: false as const, code, message } };
  }
}
