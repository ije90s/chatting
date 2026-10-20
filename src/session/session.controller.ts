import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '../common/decorators/api-response.decorator';
import { UserId } from '../common/decorators/user-id.decorator';
import { ErrorCode } from '../common/errors/error-code';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionDto } from './dto/session.dto';
import { SessionService } from './session.service';

@ApiTags('sessions')
@ApiSecurity('user-id')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  @ApiOperation({
    summary: '세션 생성',
    description: '요청한 사용자가 생성자로 기록되고 자동으로 참여한다.',
  })
  @ApiSuccessResponse(SessionDto, HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  create(
    @UserId() userId: string,
    @Body() body: CreateSessionDto,
  ): Promise<SessionDto> {
    return this.sessionService.create(userId, body.title);
  }
}
