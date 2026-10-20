import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { EventDto } from '../../event/dto/event.dto';

export const DEFAULT_EVENTS_LIMIT = 100;
export const MAX_EVENTS_LIMIT = 500;

export class ListEventsQueryDto {
  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    description: '이 seq 다음부터 조회한다. 마지막으로 받은 seq를 넣는다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq?: number;

  @ApiPropertyOptional({
    default: DEFAULT_EVENTS_LIMIT,
    minimum: 1,
    maximum: MAX_EVENTS_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_EVENTS_LIMIT)
  limit?: number;
}

export class EventListDto {
  @ApiProperty({ type: [EventDto], description: 'seq 오름차순' })
  items: EventDto[];

  @ApiProperty({
    example: false,
    description: 'true면 마지막 항목의 seq를 afterSeq로 다시 조회한다.',
  })
  hasMore: boolean;
}
