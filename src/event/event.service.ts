import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { Participant } from '../session/entities/participant.entity';
import { Session } from '../session/entities/session.entity';
import { SessionStatus } from '../session/session-status';
import {
  initialSessionState,
  isAlreadyApplied,
  reduce,
  SessionState,
} from '../session/session.reducer';
import { EventDto } from './dto/event.dto';
import { Message } from './entities/message.entity';
import { EventPayload, EventType } from './event-type';
import { EventRepository } from './event.repository';

export interface AppendEventInput {
  type: Exclude<EventType, typeof EventType.SESSION_CREATED>;
  actorId: string;
  clientEventId?: string | null;
  payload?: EventPayload;
  clientSentAt?: Date | null;
}

export interface AppendEventResult {
  event: EventDto;
  // false면 이미 저장된 이벤트를 돌려준 것이다(중복 요청). broadcast하지 않는다.
  created: boolean;
}

export interface CreateSessionInput {
  title: string;
  actorId: string;
}

type NewEvent = Omit<Message, 'id' | 'session'>;

// 이벤트 저장의 단일 경로. 이벤트와 프로젝션(sessions, participants)을 한 트랜잭션에서 저장한다.
@Injectable()
export class EventService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventRepository: EventRepository,
  ) {}

  // SESSION_CREATED(seq 1)와 생성자의 PARTICIPANT_JOINED(seq 2)를 함께 저장한다.
  async createSession(input: CreateSessionInput): Promise<EventDto[]> {
    const sessionId = uuidv7();
    const receivedAt = new Date();
    const events: NewEvent[] = [
      this.newEvent(sessionId, 1, receivedAt, {
        type: EventType.SESSION_CREATED,
        actorId: input.actorId,
        payload: { title: input.title },
      }),
      this.newEvent(sessionId, 2, receivedAt, {
        type: EventType.PARTICIPANT_JOINED,
        actorId: input.actorId,
      }),
    ];
    const state = events.reduce(
      (current, event) => reduce(current, this.toReducible(event)),
      initialSessionState,
    );

    return this.dataSource.transaction(async (manager) => {
      await this.eventRepository.insertSession(manager, {
        id: sessionId,
        title: input.title,
        createdBy: input.actorId,
        createdAt: receivedAt,
        ...this.toSessionProjection(state, 2, receivedAt),
        endedAt: null,
      } as Session);

      const saved: Message[] = [];
      for (const event of events) {
        saved.push(await this.eventRepository.insertEvent(manager, event));
      }
      await this.saveParticipant(manager, state, events[1]);
      return saved.map((event) => EventDto.from(event));
    });
  }

  // 세션 잠금 → 중복 확인 → 상태 검증 → seq 부여 → 이벤트·프로젝션 저장
  async append(
    sessionId: string,
    input: AppendEventInput,
  ): Promise<AppendEventResult> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.eventRepository.lockSession(
        manager,
        sessionId,
      );
      if (!session) {
        throw new AppException(ErrorCode.SESSION_NOT_FOUND);
      }

      // 중복 확인은 상태 검증보다 먼저 한다. 세션이 그 뒤 END가 됐어도 기존 이벤트를 돌려준다.
      if (input.clientEventId) {
        const duplicate = await this.eventRepository.findEventByClientEventId(
          manager,
          sessionId,
          input.clientEventId,
        );
        if (duplicate) {
          return { event: EventDto.from(duplicate), created: false };
        }
      }

      const state = await this.loadState(manager, session);
      if (isAlreadyApplied(state, input.type, input.actorId)) {
        return {
          event: await this.findAppliedEvent(manager, sessionId, input),
          created: false,
        };
      }

      const receivedAt = new Date();
      const event = this.newEvent(
        sessionId,
        session.lastSeq + 1,
        receivedAt,
        input,
      );
      const next = reduce(state, this.toReducible(event));

      const saved = await this.eventRepository.insertEvent(manager, event);
      await this.eventRepository.updateSession(manager, sessionId, {
        ...this.toSessionProjection(next, event.seq, receivedAt),
        ...(event.type === EventType.SESSION_ENDED && { endedAt: receivedAt }),
      });
      await this.saveParticipant(manager, next, event);
      return { event: EventDto.from(saved), created: true };
    });
  }

  // 프로젝션 테이블에서 reducer 상태를 만든다.
  private async loadState(
    manager: EntityManager,
    session: Session,
  ): Promise<SessionState> {
    const participants = await this.eventRepository.findParticipants(
      manager,
      session.id,
    );
    const lastMessage =
      session.lastMessageSeq === null
        ? null
        : await this.eventRepository.findEventBySeq(
            manager,
            session.id,
            session.lastMessageSeq,
          );
    return {
      status: session.status,
      participants: participants.map((p) => ({
        userId: p.userId,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt?.toISOString() ?? null,
        presence: p.presence,
      })),
      messageCount: session.messageCount,
      lastMessage: lastMessage && {
        seq: lastMessage.seq,
        actorId: lastMessage.actorId,
        content: String(lastMessage.payload.content),
        receivedAt: lastMessage.receivedAt.toISOString(),
      },
    };
  }

  // join/leave/end가 이미 반영된 경우 그때 저장된 이벤트를 찾는다.
  private async findAppliedEvent(
    manager: EntityManager,
    sessionId: string,
    input: AppendEventInput,
  ): Promise<EventDto> {
    const event = await this.eventRepository.findLatestEvent(
      manager,
      sessionId,
      input.type,
      // 종료 이벤트는 다른 참여자가 만들었을 수 있다.
      input.type === EventType.SESSION_ENDED ? undefined : input.actorId,
    );
    if (!event) {
      throw new Error(
        `반영된 ${input.type} 이벤트가 없습니다: session=${sessionId}`,
      );
    }
    return EventDto.from(event);
  }

  // 행위자의 참여자 행만 바뀌므로 그 행만 저장한다.
  private async saveParticipant(
    manager: EntityManager,
    state: SessionState,
    event: NewEvent,
  ): Promise<void> {
    const isPresence =
      event.type === EventType.PRESENCE_ONLINE ||
      event.type === EventType.PRESENCE_OFFLINE;
    const changesParticipant =
      isPresence ||
      event.type === EventType.PARTICIPANT_JOINED ||
      event.type === EventType.PARTICIPANT_LEFT;
    if (!changesParticipant) {
      return;
    }

    const participant = state.participants.find(
      (p) => p.userId === event.actorId,
    )!;
    const row: Partial<Participant> = {
      sessionId: event.sessionId,
      userId: participant.userId,
      joinedAt: new Date(participant.joinedAt),
      leftAt: participant.leftAt ? new Date(participant.leftAt) : null,
      presence: participant.presence,
      ...(isPresence && { presenceAt: event.receivedAt }),
    };
    await this.eventRepository.upsertParticipant(manager, row);
  }

  private toSessionProjection(
    state: SessionState,
    lastSeq: number,
    updatedAt: Date,
  ) {
    return {
      status: state.status ?? SessionStatus.JOIN,
      lastSeq,
      participantCount: state.participants.length,
      messageCount: state.messageCount,
      lastMessageSeq: state.lastMessage?.seq ?? null,
      updatedAt,
    };
  }

  private newEvent(
    sessionId: string,
    seq: number,
    receivedAt: Date,
    input: Omit<AppendEventInput, 'type'> & { type: EventType },
  ): NewEvent {
    return {
      sessionId,
      seq,
      type: input.type,
      actorId: input.actorId,
      clientEventId: input.clientEventId ?? null,
      payload: input.payload ?? {},
      clientSentAt: input.clientSentAt ?? null,
      receivedAt,
    };
  }

  private toReducible(event: NewEvent) {
    return { ...event, receivedAt: event.receivedAt.toISOString() };
  }
}
