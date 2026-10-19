import { IsString, Length } from 'class-validator';
import { AppException } from '../errors/app.exception';
import { createValidationPipe } from './validation.pipe';

class SampleDto {
  @IsString()
  @Length(1, 100)
  title: string;
}

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();
  const metadata = { type: 'body' as const, metatype: SampleDto };

  it('올바른 요청은 DTO 인스턴스로 변환한다', async () => {
    await expect(
      pipe.transform({ title: '상담 문의' }, metadata),
    ).resolves.toBeInstanceOf(SampleDto);
  });

  it('검증 실패는 VALIDATION_ERROR AppException으로 던진다', async () => {
    const error = (await pipe
      .transform({ title: '' }, metadata)
      .catch((e: unknown) => e)) as AppException;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('title');
  });

  it('정의되지 않은 필드는 거절한다', async () => {
    const error = (await pipe
      .transform({ title: 'a', extra: 1 }, metadata)
      .catch((e: unknown) => e)) as AppException;
    expect(error).toBeInstanceOf(AppException);
    expect(error.message).toContain('extra');
  });
});
