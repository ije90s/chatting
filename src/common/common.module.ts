import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { HttpExceptionFilter } from './errors/http-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { createValidationPipe } from './pipes/validation.pipe';

// 전역 검증, 응답 형식, 에러 형식. main.ts가 아닌 모듈에 두어 e2e 테스트에도 적용된다.
@Module({
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class CommonModule {}
