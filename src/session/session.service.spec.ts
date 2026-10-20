/* eslint-disable @typescript-eslint/unbound-method -- jest mock 메서드를 expect에 넘기는 패턴 */
import { EventDto } from '../event/dto/event.dto';
import { EventService } from '../event/event.service';
import { Participant } from './entities/participant.entity';
import { Presence, SessionStatus } from './session-status';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

const SESSION_ID = '0192a3b4-0000-7000-8000-000000000001';
const CREATED_AT = new Date('2026-10-19T06:00:00.000Z');

describe('SessionService.create', () => {
  let service: SessionService;
  let eventService: jest.Mocked<EventService>;
  let repo: jest.Mocked<SessionRepository>;

  beforeEach(() => {
    eventService = {
      createSession: jest.fn().mockResolvedValue([
        { sessionId: SESSION_ID, seq: 1 },
        { sessionId: SESSION_ID, seq: 2 },
      ] as EventDto[]),
    } as unknown as jest.Mocked<EventService>;
    repo = {
      findById: jest.fn().mockResolvedValue({
        id: SESSION_ID,
        title: '상담 문의',
        status: SessionStatus.JOIN,
        createdBy: 'user-a',
        lastSeq: '2',
        createdAt: CREATED_AT,
        endedAt: null,
      }),
      findParticipants: jest.fn().mockResolvedValue([
        {
          sessionId: SESSION_ID,
          userId: 'user-a',
          joinedAt: CREATED_AT,
          leftAt: null,
          presence: Presence.OFFLINE,
        } as Participant,
      ]),
    } as unknown as jest.Mocked<SessionRepository>;
    service = new SessionService(eventService, repo);
  });

  it('요청자를 생성자로 EventService에 넘긴다', async () => {
    await service.create('user-a', '상담 문의');
    expect(eventService.createSession).toHaveBeenCalledWith({
      title: '상담 문의',
      actorId: 'user-a',
    });
  });

  it('저장된 프로젝션을 세션 형식으로 돌려준다', async () => {
    await expect(service.create('user-a', '상담 문의')).resolves.toEqual({
      id: SESSION_ID,
      title: '상담 문의',
      status: 'JOIN',
      createdBy: 'user-a',
      participants: [
        {
          userId: 'user-a',
          joinedAt: '2026-10-19T06:00:00.000Z',
          leftAt: null,
          presence: 'OFFLINE',
        },
      ],
      lastSeq: 2,
      createdAt: '2026-10-19T06:00:00.000Z',
      endedAt: null,
    });
  });

  it('저장 실패는 그대로 전파하고 조회하지 않는다', async () => {
    eventService.createSession.mockRejectedValue(new Error('db down'));
    await expect(service.create('user-a', '상담 문의')).rejects.toThrow(
      'db down',
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
