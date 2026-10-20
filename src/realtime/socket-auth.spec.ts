import { authenticateSocket, ChatSocket, SocketAuthError } from './socket-auth';

function socketWith(auth: Record<string, unknown>): ChatSocket {
  return { handshake: { auth }, data: {} } as unknown as ChatSocket;
}

describe('authenticateSocket', () => {
  it('auth.userId를 앞뒤 공백을 제거해 socket.data에 담고 통과시킨다', () => {
    const socket = socketWith({ userId: ' user-a ' });
    const next = jest.fn();
    authenticateSocket(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('user-a');
  });

  it.each([
    ['없음', {}],
    ['빈 값', { userId: '  ' }],
    ['문자열 아님', { userId: 1 }],
  ])('userId가 %s이면 UNAUTHORIZED로 거부한다', (_name, auth) => {
    const next = jest.fn<void, [Error?]>();
    authenticateSocket(socketWith(auth), next);
    const error = next.mock.calls[0][0] as SocketAuthError;
    expect(error).toBeInstanceOf(SocketAuthError);
    expect(error.data).toEqual({
      success: false,
      code: 'UNAUTHORIZED',
      message: '사용자 식별 정보가 없습니다.',
    });
  });

  it('64자를 넘으면 VALIDATION_ERROR로 거부한다', () => {
    const next = jest.fn<void, [Error?]>();
    authenticateSocket(socketWith({ userId: 'a'.repeat(65) }), next);
    expect((next.mock.calls[0][0] as SocketAuthError).data.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});
