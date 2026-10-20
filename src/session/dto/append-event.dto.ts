import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { EventType } from '../../event/event-type';

// POST /sessions/{id}/events로 받는 타입. 참여와 종료는 전용 엔드포인트를 쓴다.
export const APPENDABLE_EVENT_TYPES = [
  EventType.MESSAGE_CREATED,
  EventType.PARTICIPANT_LEFT,
] as const;

export type AppendableEventType = (typeof APPENDABLE_EVENT_TYPES)[number];

// 이모지가 2자로 세지지 않도록 코드 포인트 수로 센다.
export const MAX_MESSAGE_LENGTH = 5000;

function isValidContent(content: unknown): boolean {
  return (
    typeof content === 'string' &&
    content.trim().length > 0 &&
    [...content].length <= MAX_MESSAGE_LENGTH
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// payload 형식은 type에 따라 다르다.
// MESSAGE_CREATED: { content: 공백만이 아닌 5000자 이하 문자열 }, PARTICIPANT_LEFT: 없거나 {}
@ValidatorConstraint({ name: 'eventPayload' })
class EventPayloadConstraint implements ValidatorConstraintInterface {
  validate(payload: unknown, args: ValidationArguments): boolean {
    const { type } = args.object as AppendEventDto;
    if (type === EventType.MESSAGE_CREATED) {
      return (
        isPlainObject(payload) &&
        Object.keys(payload).length === 1 &&
        isValidContent(payload.content)
      );
    }
    if (type === EventType.PARTICIPANT_LEFT) {
      return (
        payload === undefined ||
        (isPlainObject(payload) && Object.keys(payload).length === 0)
      );
    }
    // type 오류는 type 필드에서 알린다.
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const { type } = args.object as AppendEventDto;
    return type === EventType.MESSAGE_CREATED
      ? `MESSAGE_CREATED의 payload는 { content: 공백만이 아닌 ${MAX_MESSAGE_LENGTH}자 이하 문자열 }이어야 합니다.`
      : 'PARTICIPANT_LEFT의 payload는 비어 있어야 합니다.';
  }
}

export class AppendEventDto {
  @ApiProperty({
    format: 'uuid',
    example: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
    description:
      '클라이언트가 만든 UUID(v4 권장). 재전송할 때도 같은 값을 쓴다.',
  })
  @IsUUID('all')
  clientEventId: string;

  @ApiProperty({ enum: APPENDABLE_EVENT_TYPES, example: 'MESSAGE_CREATED' })
  @IsIn(APPENDABLE_EVENT_TYPES)
  type: AppendableEventType;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { content: '안녕하세요' },
    description:
      'MESSAGE_CREATED: { content } (필수, 공백만이면 안 됨, 5000자 이하) / PARTICIPANT_LEFT: {} 또는 생략',
  })
  @Validate(EventPayloadConstraint)
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '2026-10-19T06:20:00.100Z',
    description: '참고용 시각. 정렬에 쓰지 않는다.',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  clientSentAt?: string;
}
