import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { EventType } from '../event/event-type';
import { AppendEventResult, EventService } from '../event/event.service';
import { AppendEventDto } from './dto/append-event.dto';
import {
  DEFAULT_LIST_LIMIT,
  ListSessionsQueryDto,
  SessionListDto,
} from './dto/list-sessions.dto';
import { SessionDto } from './dto/session.dto';
import { decodeCursor, encodeCursor } from './session-cursor';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionService {
  constructor(
    private readonly eventService: EventService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  // 저장은 EventService가 하고, 응답은 커밋된 프로젝션에서 만든다.
  async create(userId: string, title: string): Promise<SessionDto> {
    const [created] = await this.eventService.createSession({
      title,
      actorId: userId,
    });
    return this.findOne(created.sessionId);
  }

  // 이미 참여 중이면 기존 PARTICIPANT_JOINED 이벤트를 돌려준다(created: false).
  join(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: userId,
    });
  }

  // 이미 END면 기존 SESSION_ENDED 이벤트를 돌려준다(created: false). 다른 참여자가 종료했어도 같다.
  end(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: EventType.SESSION_ENDED,
      actorId: userId,
    });
  }

  // 메시지, 나가기. 같은 clientEventId나 이미 나간 사용자의 나가기는 기존 이벤트를 돌려준다(created: false).
  appendEvent(
    sessionId: string,
    userId: string,
    body: AppendEventDto,
  ): Promise<AppendEventResult> {
    return this.eventService.append(sessionId, {
      type: body.type,
      actorId: userId,
      clientEventId: body.clientEventId,
      payload:
        body.type === EventType.MESSAGE_CREATED
          ? { content: body.payload!.content }
          : {},
      clientSentAt: body.clientSentAt ? new Date(body.clientSentAt) : null,
    });
  }

  // socket 구독 권한. 참여 기록이 있으면 나간 참여자도 허용한다.
  async requireParticipant(sessionId: string, userId: string): Promise<void> {
    const [session, participant] = await Promise.all([
      this.sessionRepository.findById(sessionId),
      this.sessionRepository.findParticipant(sessionId, userId),
    ]);
    if (!session) {
      throw new AppException(ErrorCode.SESSION_NOT_FOUND);
    }
    if (!participant) {
      throw new AppException(ErrorCode.NOT_PARTICIPANT);
    }
  }

  // 한 건 더 읽어 다음 페이지가 있는지 판단한다.
  async list(query: ListSessionsQueryDto): Promise<SessionListDto> {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const rows = await this.sessionRepository.findPage({
      statuses: query.status,
      participantId: query.participantId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const participants =
      page.length > 0
        ? await this.sessionRepository.findParticipantsOf(page.map((s) => s.id))
        : [];

    const last = page.at(-1);
    return {
      items: page.map((session) =>
        SessionDto.from(
          session,
          participants.filter((p) => p.sessionId === session.id),
        ),
      ),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  private async findOne(sessionId: string): Promise<SessionDto> {
    const [session, participants] = await Promise.all([
      this.sessionRepository.findById(sessionId),
      this.sessionRepository.findParticipants(sessionId),
    ]);
    if (!session) {
      throw new Error(`저장한 세션을 찾을 수 없습니다: session=${sessionId}`);
    }
    return SessionDto.from(session, participants);
  }
}
