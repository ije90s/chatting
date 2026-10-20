import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { MetricsService } from './metrics.service';

// Prometheus 수집용. 응답 형식 통일과 X-User-Id 검사의 예외다(CLAUDE.md 코딩 규칙).
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @RawResponse()
  @ApiOperation({
    summary: 'Prometheus 메트릭',
    description:
      'Prometheus 텍스트 형식으로 돌려준다. 공통 응답 형식으로 감싸지 않고 X-User-Id도 요구하지 않는다.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus exposition format',
    schema: { type: 'string' },
  })
  async render(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.type(this.metrics.contentType);
    return this.metrics.render();
  }
}
