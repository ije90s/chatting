import { ApiProperty } from '@nestjs/swagger';
import { ParticipantStateDto } from '../../projection/dto/timeline.dto';
import { Participant } from '../entities/participant.entity';
import { Session } from '../entities/session.entity';
import { SessionStatus } from '../session-status';

// docs/api.md "세션 형식". POST /sessions, GET /sessions에서 같이 쓴다.
export class SessionDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id: string;

  @ApiProperty({ example: '상담 문의' })
  title: string;

  @ApiProperty({ enum: Object.values(SessionStatus), example: 'JOIN' })
  status: SessionStatus;

  @ApiProperty({ example: 'user-a' })
  createdBy: string;

  @ApiProperty({ type: [ParticipantStateDto] })
  participants: ParticipantStateDto[];

  @ApiProperty({ example: 42 })
  lastSeq: number;

  @ApiProperty({ example: '2026-10-19T06:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  endedAt: string | null;

  static from(session: Session, participants: Participant[]): SessionDto {
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      createdBy: session.createdBy,
      participants: participants.map((p) => ({
        userId: p.userId,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt?.toISOString() ?? null,
        presence: p.presence,
      })),
      // BIGINT는 드라이버에 따라 문자열로 올 수 있다.
      lastSeq: Number(session.lastSeq),
      createdAt: session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }
}
