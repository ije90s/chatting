import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { SessionStatus } from '../session-status';
import { SessionDto } from './session.dto';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export class ListSessionsQueryDto {
  @ApiPropertyOptional({
    type: String,
    example: 'JOIN,LEAVE',
    description: 'JOIN, LEAVE, END (쉼표로 여러 개)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()) : value,
  )
  @ArrayNotEmpty()
  @IsIn(Object.values(SessionStatus), { each: true })
  status?: SessionStatus[];

  @ApiPropertyOptional({
    example: 'user-a',
    description: '해당 사용자가 참여한 세션(나간 세션 포함)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  participantId?: string;

  @ApiPropertyOptional({
    example: '2026-10-19T00:00:00.000Z',
    description: '생성 시각 하한 (포함)',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-20T00:00:00.000Z',
    description: '생성 시각 상한 (미포함)',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;

  @ApiPropertyOptional({ description: '이전 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_LIST_LIMIT,
    minimum: 1,
    maximum: MAX_LIST_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit?: number;
}

export class SessionListDto {
  @ApiProperty({ type: [SessionDto] })
  items: SessionDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: '다음 페이지 커서. 마지막 페이지면 null',
  })
  nextCursor: string | null;
}
