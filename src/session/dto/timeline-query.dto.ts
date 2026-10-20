import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class TimelineQueryDto {
  @ApiProperty({
    example: '2026-10-19T06:25:00.000Z',
    description: '이 시각(서버 수신 시각 기준)까지의 이벤트로 복원 (ISO-8601)',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  at: string;
}
