import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '../common/decorators/api-response.decorator';
import { UserId } from '../common/decorators/user-id.decorator';
import { ErrorCode } from '../common/errors/error-code';
import { EventDto } from '../event/dto/event.dto';
import { TimelineDto } from '../projection/dto/timeline.dto';
import { ProjectionService } from '../projection/projection.service';
import { AppendEventDto } from './dto/append-event.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { ListSessionsQueryDto, SessionListDto } from './dto/list-sessions.dto';
import { SessionDto } from './dto/session.dto';
import { TimelineQueryDto } from './dto/timeline-query.dto';
import { SessionService } from './session.service';

@ApiTags('sessions')
@ApiSecurity('user-id')
@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly projectionService: ProjectionService,
  ) {}

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

  @Get()
  @ApiOperation({
    summary: '세션 목록',
    description:
      '상태/참여자/생성 시각(from 이상, to 미만)으로 거른다. createdAt DESC, id DESC 순서이며 커서로 페이지를 나눈다.',
  })
  @ApiSuccessResponse(SessionListDto)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  // 조회 범위는 전체 세션이다. 헤더는 사용자 식별만 확인한다.
  list(
    @UserId() _userId: string,
    @Query() query: ListSessionsQueryDto,
  ): Promise<SessionListDto> {
    return this.sessionService.list(query);
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: '특정 시점 상태 복원',
    description:
      'receivedAt ≤ at인 마지막 이벤트까지 적용한 상태를 돌려준다. 같은 at은 언제 조회해도 같은 결과다.',
  })
  @ApiSuccessResponse(TimelineDto)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.SESSION_NOT_FOUND)
  // 조회 범위는 GET /sessions와 같이 전체 세션이다.
  timeline(
    @UserId() _userId: string,
    @Param('id') sessionId: string,
    @Query() query: TimelineQueryDto,
  ): Promise<TimelineDto> {
    return this.projectionService.restoreTimeline(
      sessionId,
      new Date(query.at),
    );
  }

  @Post(':id/join')
  @ApiOperation({
    summary: '참여',
    description:
      '세션이 JOIN이어야 하고 참여자는 최대 2명이다. 이미 참여 중이면 기존 이벤트를 200으로 돌려준다.',
  })
  @ApiSuccessResponse(EventDto, HttpStatus.CREATED, '새로 참여')
  @ApiSuccessResponse(EventDto, HttpStatus.OK, '이미 참여 중 (기존 이벤트)')
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.SESSION_NOT_FOUND)
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.SESSION_FULL,
    ErrorCode.INVALID_SESSION_STATUS,
    ErrorCode.ALREADY_LEFT,
  )
  async join(
    @UserId() userId: string,
    @Param('id') sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EventDto> {
    const { event, created } = await this.sessionService.join(
      sessionId,
      userId,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return event;
  }

  @Post(':id/events')
  @ApiOperation({
    summary: '이벤트/메시지 수집',
    description:
      'MESSAGE_CREATED, PARTICIPANT_LEFT를 받는다. 이미 저장된 clientEventId이거나 이미 나간 사용자의 나가기는 기존 이벤트를 200으로 돌려준다.',
  })
  @ApiSuccessResponse(EventDto, HttpStatus.CREATED, '새로 저장')
  @ApiSuccessResponse(EventDto, HttpStatus.OK, '중복 요청 (기존 이벤트)')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, ErrorCode.NOT_PARTICIPANT)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.SESSION_NOT_FOUND)
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_SESSION_STATUS,
    ErrorCode.ALREADY_LEFT,
  )
  async appendEvent(
    @UserId() userId: string,
    @Param('id') sessionId: string,
    @Body() body: AppendEventDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EventDto> {
    const { event, created } = await this.sessionService.appendEvent(
      sessionId,
      userId,
      body,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return event;
  }

  @Post(':id/end')
  @ApiOperation({
    summary: '종료',
    description:
      'JOIN 또는 LEAVE 세션을 END로 바꾼다. 참여 중인(나가지 않은) 사용자만 호출할 수 있다. 이미 END면 기존 이벤트를 200으로 돌려준다.',
  })
  @ApiSuccessResponse(EventDto, HttpStatus.CREATED, '새로 종료')
  @ApiSuccessResponse(EventDto, HttpStatus.OK, '이미 종료됨 (기존 이벤트)')
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, ErrorCode.NOT_PARTICIPANT)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.SESSION_NOT_FOUND)
  async end(
    @UserId() userId: string,
    @Param('id') sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EventDto> {
    const { event, created } = await this.sessionService.end(sessionId, userId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return event;
  }
}
