/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { SessionService } from '../session/session.service';
import { ChatGateway } from './chat.gateway';
import type { ChatSocket } from './socket-auth';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';

describe('ChatGateway 구독', () => {
  let gateway: ChatGateway;
  let sessionService: jest.Mocked<SessionService>;
  let socket: jest.Mocked<ChatSocket>;

  beforeEach(() => {
    sessionService = {
      requireParticipant: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SessionService>;
    socket = {
      data: { userId: 'user-a' },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as unknown as jest.Mocked<ChatSocket>;
    gateway = new ChatGateway(sessionService);
  });

  it('참여자면 session:{id} room에 넣고 성공 ack를 돌려준다', async () => {
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({ success: true, data: { sessionId: SESSION_ID } });
    expect(sessionService.requireParticipant).toHaveBeenCalledWith(
      SESSION_ID,
      'user-a',
    );
    expect(socket.join).toHaveBeenCalledWith(`session:${SESSION_ID}`);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('권한이 없으면 room에 넣지 않고 session:error와 ack로 알린다', async () => {
    sessionService.requireParticipant.mockRejectedValue(
      new AppException(ErrorCode.NOT_PARTICIPANT),
    );
    const failure = {
      success: false,
      code: 'NOT_PARTICIPANT',
      message: '세션 참여자가 아닙니다.',
    };
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual(failure);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('session:error', failure);
  });

  it.each([
    ['payload 없음', undefined],
    ['sessionId 없음', {}],
    ['빈 sessionId', { sessionId: '' }],
    ['문자열이 아닌 sessionId', { sessionId: 1 }],
  ])('%s은 VALIDATION_ERROR', async (_name, body) => {
    await expect(gateway.subscribe(socket, body)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    expect(sessionService.requireParticipant).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'session:error',
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('알 수 없는 에러는 내부 정보를 숨기고 INTERNAL_ERROR', async () => {
    sessionService.requireParticipant.mockRejectedValue(
      new Error('db password leaked'),
    );
    jest
      .spyOn(gateway['errorMapper']['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(
      gateway.subscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    });
  });

  it('구독 해제는 room에서 빼고 성공 ack를 돌려준다', async () => {
    await expect(
      gateway.unsubscribe(socket, { sessionId: SESSION_ID }),
    ).resolves.toEqual({ success: true, data: { sessionId: SESSION_ID } });
    expect(socket.leave).toHaveBeenCalledWith(`session:${SESSION_ID}`);
  });

  it('구독 해제도 sessionId가 없으면 VALIDATION_ERROR', async () => {
    await expect(gateway.unsubscribe(socket, {})).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});
