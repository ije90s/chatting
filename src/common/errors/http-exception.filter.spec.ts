import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from './error-code';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('AppException은 코드에 정의된 상태와 메시지를 쓴다', () => {
    expect(
      filter.toErrorResponse(new AppException(ErrorCode.SESSION_FULL)),
    ).toEqual({
      status: 409,
      body: {
        success: false,
        code: 'SESSION_FULL',
        message: '참여자가 이미 2명입니다.',
      },
    });
  });

  it('AppException의 메시지를 덮어쓸 수 있다', () => {
    const { body } = filter.toErrorResponse(
      new AppException(ErrorCode.VALIDATION_ERROR, 'title must be a string'),
    );
    expect(body.message).toBe('title must be a string');
  });

  it('프레임워크의 400은 VALIDATION_ERROR가 된다', () => {
    expect(
      filter.toErrorResponse(new BadRequestException('Unexpected token')),
    ).toEqual({
      status: 400,
      body: {
        success: false,
        code: 'VALIDATION_ERROR',
        message: '요청 형식이 올바르지 않습니다.',
      },
    });
  });

  it('없는 경로의 404는 NOT_FOUND가 된다', () => {
    const { status, body } = filter.toErrorResponse(new NotFoundException());
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('알 수 없는 에러는 내부 정보를 숨기고 500 INTERNAL_ERROR가 된다', () => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    expect(filter.toErrorResponse(new Error('db password leaked'))).toEqual({
      status: 500,
      body: {
        success: false,
        code: 'INTERNAL_ERROR',
        message: '서버 내부 오류가 발생했습니다.',
      },
    });
  });
});
