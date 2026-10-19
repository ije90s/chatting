import { ApiProperty } from '@nestjs/swagger';
import { Message } from '../entities/message.entity';
import { EventType } from '../event-type';
import type { EventPayload } from '../event-type';

// docs/api.md "이벤트 공통 형식". REST 응답과 socket 전달에서 같이 쓴다.
export class EventDto {
  @ApiProperty({ example: 1024 })
  eventId: number;

  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  sessionId: string;

  @ApiProperty({ example: 7, description: '세션 안에서의 정식 순서' })
  seq: number;

  @ApiProperty({ enum: Object.values(EventType), example: 'MESSAGE_CREATED' })
  type: EventType;

  @ApiProperty({ example: 'user-a' })
  actorId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  })
  clientEventId: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { content: '안녕하세요' },
  })
  payload: EventPayload;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-10-19T06:20:00.100Z',
  })
  clientSentAt: string | null;

  @ApiProperty({ example: '2026-10-19T06:20:00.123Z' })
  receivedAt: string;

  static from(message: Message): EventDto {
    return {
      eventId: message.id,
      sessionId: message.sessionId,
      seq: message.seq,
      type: message.type,
      actorId: message.actorId,
      clientEventId: message.clientEventId,
      payload: message.payload,
      clientSentAt: message.clientSentAt?.toISOString() ?? null,
      receivedAt: message.receivedAt.toISOString(),
    };
  }
}
