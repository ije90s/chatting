import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ example: '상담 문의', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  title: string;
}
