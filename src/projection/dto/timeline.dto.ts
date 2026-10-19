import { ApiProperty } from '@nestjs/swagger';
import { Presence, SessionStatus } from '../../session/session-status';

export class ParticipantStateDto {
  @ApiProperty({ example: 'user-a' })
  userId: string;

  @ApiProperty({ example: '2026-10-19T06:00:00.000Z' })
  joinedAt: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  leftAt: string | null;

  @ApiProperty({ enum: Object.values(Presence), example: 'ONLINE' })
  presence: Presence;
}

export class LastMessageDto {
  @ApiProperty({ example: 17 })
  seq: number;

  @ApiProperty({ example: 'user-a' })
  actorId: string;

  @ApiProperty({ example: '안녕하세요' })
  content: string;

  @ApiProperty({ example: '2026-10-19T06:24:59.000Z' })
  receivedAt: string;
}

export class SessionStateDto {
  @ApiProperty({ enum: Object.values(SessionStatus), example: 'JOIN' })
  status: SessionStatus;

  @ApiProperty({ type: [ParticipantStateDto] })
  participants: ParticipantStateDto[];

  @ApiProperty({ example: 12 })
  messageCount: number;

  @ApiProperty({ type: LastMessageDto, nullable: true })
  lastMessage: LastMessageDto | null;
}

// docs/api.md "GET /sessions/{id}/timeline?at=" 응답
export class TimelineDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  sessionId: string;

  @ApiProperty({ example: '2026-10-19T06:25:00.000Z' })
  at: string;

  @ApiProperty({
    example: 18,
    description: '복원에 사용한 마지막 이벤트의 seq',
  })
  seq: number;

  @ApiProperty({ type: SessionStateDto })
  state: SessionStateDto;
}
