import { AppException } from '../common/errors/app.exception';
import { decodeCursor, encodeCursor } from './session-cursor';

describe('session cursor', () => {
  const cursor = {
    createdAt: new Date('2026-10-19T06:00:00.123Z'),
    id: '0192a3b4-0000-7000-8000-000000000001',
  };

  it('인코딩한 커서를 그대로 복원한다(밀리초 포함)', () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  it.each([
    ['base64가 아닌 값', '!!!'],
    ['JSON이 아닌 값', Buffer.from('abc').toString('base64url')],
    ['객체가 아닌 JSON', b64(1)],
    ['createdAt 없음', b64({ id: 'a' })],
    ['날짜가 아닌 createdAt', b64({ createdAt: 'x', id: 'a' })],
    ['id 없음', b64({ createdAt: '2026-10-19T06:00:00.000Z' })],
    ['빈 id', b64({ createdAt: '2026-10-19T06:00:00.000Z', id: '' })],
  ])('%s은 VALIDATION_ERROR', (_name, value) => {
    expect(() => decodeCursor(value)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }) as AppException,
    );
  });
});
