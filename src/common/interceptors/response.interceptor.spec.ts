import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { RawResponse } from '../decorators/raw-response.decorator';
import { ResponseInterceptor } from './response.interceptor';

class TestController {
  wrapped(this: void) {}

  @RawResponse()
  raw(this: void) {}
}

function contextOf(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

const next = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor(new Reflector());

  it('반환값을 { success: true, data }로 감싼다', async () => {
    const result = interceptor.intercept(
      contextOf(TestController.prototype.wrapped),
      next({ id: 1 }),
    );
    await expect(lastValueFrom(result)).resolves.toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('@RawResponse() 핸들러는 반환값을 그대로 둔다', async () => {
    const result = interceptor.intercept(
      contextOf(TestController.prototype.raw),
      next('# HELP up'),
    );
    await expect(lastValueFrom(result)).resolves.toBe('# HELP up');
  });
});
