import { Socket } from 'socket.io';
import { extractUserId } from '../common/decorators/user-id.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

export interface ChatSocketData {
  userId: string;
}

// 서버 → 클라이언트 이벤트 (docs/api.md "실시간")
export interface ServerToClientEvents {
  'session:error': (error: ErrorResponseDto) => void;
}

export type ChatSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  ChatSocketData
>;

// connect_error로 전달할 에러. data는 REST 실패 응답과 같은 형식이다.
export class SocketAuthError extends Error {
  constructor(readonly data: ErrorResponseDto) {
    super(data.message);
  }
}

// handshake { auth: { userId } }를 REST의 X-User-Id와 같은 규칙으로 검사한다. 실패하면 연결을 거부한다.
export function authenticateSocket(
  socket: ChatSocket,
  next: (err?: Error) => void,
): void {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const raw = auth.userId;
  try {
    socket.data.userId = extractUserId(
      typeof raw === 'string' ? raw : undefined,
    );
    next();
  } catch (error) {
    const { code, message } = error as AppException;
    next(new SocketAuthError({ success: false, code, message }));
  }
}
