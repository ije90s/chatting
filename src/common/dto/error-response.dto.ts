import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code';

export class ErrorResponseDto {
  @ApiProperty({ example: false, enum: [false] })
  success: false;

  @ApiProperty({
    enum: Object.values(ErrorCode),
    example: ErrorCode.INVALID_SESSION_STATUS,
  })
  code: ErrorCode;

  @ApiProperty({ example: '현재 세션 상태에서 허용되지 않는 요청입니다.' })
  message: string;
}
