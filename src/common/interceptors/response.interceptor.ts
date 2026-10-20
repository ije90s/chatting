import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { RAW_RESPONSE } from '../decorators/raw-response.decorator';

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

// 컨트롤러 반환값을 { success: true, data }로 감싼다. @RawResponse()가 붙은 핸들러는 그대로 둔다.
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  SuccessResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
