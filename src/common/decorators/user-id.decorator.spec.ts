import { AppException } from '../errors/app.exception';
import { extractUserId } from './user-id.decorator';

describe('extractUserId', () => {
  it('헤더 값을 앞뒤 공백을 제거해 돌려준다', () => {
    expect(extractUserId(' user-a ')).toBe('user-a');
  });

  it.each([undefined, '', '   ', ['user-a', 'user-b']])(
    '값이 없거나 하나가 아니면 UNAUTHORIZED (%p)',
    (value) => {
      expect(() => extractUserId(value)).toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED' }) as AppException,
      );
    },
  );

  it('64자를 넘으면 VALIDATION_ERROR', () => {
    expect(extractUserId('a'.repeat(64))).toHaveLength(64);
    expect(() => extractUserId('a'.repeat(65))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }) as AppException,
    );
  });
});
