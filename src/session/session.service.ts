import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { EventType } from '../event/event-type';
import {
  AppendEventInput,
  AppendEventResult,
  EventService,
} from '../event/event.service';
import { Broadcaster } from '../realtime/broadcaster';
import { SessionQueue } from '../realtime/session-queue';
import { EventDto } from '../event/dto/event.dto';
import { MetricsService } from '../metrics/metrics.service';
import { AppendEventDto } from './dto/append-event.dto';
import {
  DEFAULT_EVENTS_LIMIT,
  EventListDto,
  ListEventsQueryDto,
} from './dto/list-events.dto';
import {
  DEFAULT_LIST_LIMIT,
  ListSessionsQueryDto,
  SessionListDto,
} from './dto/list-sessions.dto';
import { SessionDto } from './dto/session.dto';
import { decodeCursor, encodeCursor } from './session-cursor';
import { Presence } from './session-status';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionService {
  constructor(
    private readonly eventService: EventService,
    private readonly sessionRepository: SessionRepository,
    private readonly broadcaster: Broadcaster,
    private readonly sessionQueue: SessionQueue,
    private readonly metrics: MetricsService,
  ) {}

  // 저장은 EventService가 하고, 응답은 커밋된 프로젝션에서 만든다.
  async create(userId: string, title: string): Promise<SessionDto> {
    const { events } = await this.metrics.observeAppend(
      EventType.SESSION_CREATED,
      async () => ({
        created: true,
        events: await this.eventService.createSession({
          title,
          actorId: userId,
        }),
      }),
    );
    // 생성 직후에는 구독자가 있을 수 없지만, 커밋된 모든 이벤트를 같은 경로로 전달한다.
    // 새 세션 ID는 아직 아무도 모르므로 같은 세션의 다른 쓰기와 겹치지 않아 세션 큐가 필요 없다.
    this.broadcaster.broadcast(events);
    return this.findOne(events[0].sessionId);
  }

  // 이미 참여 중이면 기존 PARTICIPANT_JOINED 이벤트를 돌려준다(created: false).
  join(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.appendAndBroadcast(sessionId, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: userId,
    });
  }

  // 이미 END면 기존 SESSION_ENDED 이벤트를 돌려준다(created: false). 다른 참여자가 종료했어도 같다.
  end(sessionId: string, userId: string): Promise<AppendEventResult> {
    return this.appendAndBroadcast(sessionId, {
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
    return this.appendAndBroadcast(sessionId, {
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

  // 누락 조회: 클라이언트가 seq 빈칸을 발견하거나 재접속했을 때 마지막으로 받은 seq 이후를 채운다.
  // 메시지 본문을 모두 돌려주므로 참여자(나간 참여자 포함)만 조회할 수 있다.
  async listEvents(
    sessionId: string,
    userId: string,
    query: ListEventsQueryDto,
  ): Promise<EventListDto> {
    await this.requireParticipant(sessionId, userId);
    const limit = query.limit ?? DEFAULT_EVENTS_LIMIT;
    const events = await this.sessionRepository.findEventsAfter(
      sessionId,
      query.afterSeq ?? 0,
      limit + 1,
    );
    return {
      items: events.slice(0, limit).map((event) => EventDto.from(event)),
      hasMore: events.length > limit,
    };
  }

  // socket 구독과 누락 조회 권한. 참여 기록이 있으면 나간 참여자도 허용한다.
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

  // 서버 시작 시 presence 정리에 쓴다.
  async findOnlineParticipants(): Promise<
    { sessionId: string; userId: string }[]
  > {
    const participants = await this.sessionRepository.findByPresence(
      Presence.ONLINE,
    );
    return participants.map(({ sessionId, userId }) => ({ sessionId, userId }));
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

  // append는 커밋까지 끝난 뒤 돌아온다. 중복 요청(created: false)은 다시 전달하지 않는다.
  // 세션 큐 안에서 저장과 전달을 함께 해야 broadcast가 seq 순서로 나간다.
  private appendAndBroadcast(
    sessionId: string,
    input: AppendEventInput,
  ): Promise<AppendEventResult> {
    return this.sessionQueue.run(sessionId, async () => {
      const result = await this.metrics.observeAppend(input.type, () =>
        this.eventService.append(sessionId, input),
      );
      if (result.created) {
        this.broadcaster.broadcast([result.event]);
      }
      return result;
    });
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
