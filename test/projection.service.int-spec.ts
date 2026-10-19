import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/typeorm.config';
import { Message } from '../src/event/entities/message.entity';
import { EventType } from '../src/event/event-type';
import { EventRepository } from '../src/event/event.repository';
import { EventService } from '../src/event/event.service';
import { Snapshot } from '../src/projection/entities/snapshot.entity';
import { ProjectionRepository } from '../src/projection/projection.repository';
import { ProjectionService } from '../src/projection/projection.service';
import { replay } from '../src/session/session.reducer';

// 실제 MariaDB에서 타임라인 복원이 이벤트 전체 재적용 결과와 같은지 확인한다.
describe('ProjectionService (MariaDB)', () => {
  let dataSource: DataSource;
  let events: EventService;
  let projection: ProjectionService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(process.env));
    await dataSource.initialize();
    events = new EventService(dataSource, new EventRepository());
    projection = new ProjectionService(
      new ProjectionRepository(
        dataSource.getRepository(Message),
        dataSource.getRepository(Snapshot),
      ),
    );
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM snapshots');
    await dataSource.query('DELETE FROM messages');
    await dataSource.query('DELETE FROM participants');
    await dataSource.query('DELETE FROM sessions');
  });

  afterAll(() => dataSource.destroy());

  let counter = 0;
  function uuid(): string {
    counter += 1;
    return `00000000-0000-4000-9000-${String(counter).padStart(12, '0')}`;
  }

  // 생성(1), 참여(2, 3), presence(4), 메시지 98개(5~102), 나가기(103), 종료(104).
  // 스냅샷은 2, 3, 100, 103, 104에 남는다.
  async function buildSession(): Promise<string> {
    const [created] = await events.createSession({
      title: '상담 문의',
      actorId: 'user-a',
    });
    const id = created.sessionId;
    await events.append(id, {
      type: EventType.PARTICIPANT_JOINED,
      actorId: 'user-b',
    });
    await events.append(id, {
      type: EventType.PRESENCE_ONLINE,
      actorId: 'user-b',
    });
    for (let i = 0; i < 98; i++) {
      await events.append(id, {
        type: EventType.MESSAGE_CREATED,
        actorId: i % 2 ? 'user-a' : 'user-b',
        clientEventId: uuid(),
        payload: { content: `메시지 ${i}` },
      });
    }
    await events.append(id, {
      type: EventType.PARTICIPANT_LEFT,
      actorId: 'user-b',
      clientEventId: uuid(),
    });
    await events.append(id, {
      type: EventType.SESSION_ENDED,
      actorId: 'user-a',
    });
    return id;
  }

  async function logOf(sessionId: string) {
    return dataSource
      .getRepository(Message)
      .find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  // 정의 그대로의 기대값: receivedAt ≤ at인 이벤트 중 가장 큰 seq까지 처음부터 재적용
  function expectedAt(log: Message[], at: Date) {
    const seq = Math.max(
      ...log.filter((e) => e.receivedAt <= at).map((e) => e.seq),
    );
    const state = replay(
      log
        .filter((e) => e.seq <= seq)
        .map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })),
    );
    return { seq, state };
  }

  it('모든 이벤트 시각에서 복원 결과가 처음부터 재적용한 결과와 같다', async () => {
    const sessionId = await buildSession();
    const log = await logOf(sessionId);
    const snapshotSeqs = (
      await dataSource.getRepository(Snapshot).find({ where: { sessionId } })
    ).map((s) => s.seq);
    expect(snapshotSeqs.sort((a, b) => a - b)).toEqual([2, 3, 100, 103, 104]);

    for (const event of log) {
      const restored = await projection.restoreTimeline(
        sessionId,
        event.receivedAt,
      );
      const expected = expectedAt(log, event.receivedAt);
      expect({ seq: restored.seq, state: restored.state }).toEqual(expected);
    }
  });

  it('스냅샷을 지워도 복원 결과가 같다 (스냅샷은 캐시)', async () => {
    const sessionId = await buildSession();
    const log = await logOf(sessionId);
    const points = [log[1], log[50], log[99], log[101], log[log.length - 1]];

    const withSnapshots = [];
    for (const event of points) {
      withSnapshots.push(
        await projection.restoreTimeline(sessionId, event.receivedAt),
      );
    }
    await dataSource.query('DELETE FROM snapshots');
    for (const [i, event] of points.entries()) {
      expect(
        await projection.restoreTimeline(sessionId, event.receivedAt),
      ).toEqual(withSnapshots[i]);
    }
  });

  it('마지막 이벤트 이후 시각은 현재 상태를 돌려준다', async () => {
    const sessionId = await buildSession();
    const restored = await projection.restoreTimeline(
      sessionId,
      new Date('2999-01-01T00:00:00.000Z'),
    );
    expect(restored.seq).toBe(104);
    expect(restored.state.status).toBe('END');
    expect(restored.state.messageCount).toBe(98);
  });

  it('세션 생성 이전 시각이나 없는 세션은 SESSION_NOT_FOUND', async () => {
    const sessionId = await buildSession();
    const [first] = await logOf(sessionId);

    await expect(
      projection.restoreTimeline(
        sessionId,
        new Date(first.receivedAt.getTime() - 1),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
    await expect(
      projection.restoreTimeline(
        '00000000-0000-7000-8000-000000000000',
        new Date(),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
  });
});
