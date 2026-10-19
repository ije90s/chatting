import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { initialSessionState, replay } from '../session/session.reducer';
import { SessionStateDto, TimelineDto } from './dto/timeline.dto';
import { ProjectionRepository } from './projection.repository';

@Injectable()
export class ProjectionService {
  constructor(private readonly projectionRepository: ProjectionRepository) {}

  // 기준 seq 결정 → 그 이하의 최근 스냅샷 로드 → 이후 이벤트를 seq 순으로 적용.
  // 기준 seq 이하의 이벤트와 스냅샷은 바뀌지 않으므로 같은 at은 언제 조회해도 같은 결과다.
  async restoreTimeline(sessionId: string, at: Date): Promise<TimelineDto> {
    const seq = await this.projectionRepository.findLastSeqAt(sessionId, at);
    // 세션이 없거나 at이 세션 생성 이전이다.
    if (seq === null) {
      throw new AppException(ErrorCode.SESSION_NOT_FOUND);
    }

    const snapshot = await this.projectionRepository.findLatestSnapshot(
      sessionId,
      seq,
    );
    const events = await this.projectionRepository.findEvents(
      sessionId,
      snapshot?.seq ?? 0,
      seq,
    );
    const state = replay(
      events.map((event) => ({
        ...event,
        receivedAt: event.receivedAt.toISOString(),
      })),
      snapshot?.state ?? initialSessionState,
    );

    return {
      sessionId,
      at: at.toISOString(),
      seq,
      // seq ≥ 1이면 SESSION_CREATED가 적용되어 status가 있다.
      state: state as SessionStateDto,
    };
  }
}
