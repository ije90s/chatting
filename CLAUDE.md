# CLAUDE.md

1:1 참여자 간 실시간 채팅 서비스. 세션 단위로 이벤트를 기록하고, 이벤트를 다시 적용해 특정 시점의 세션 상태를 복원한다.

## 기술 스택

- TypeScript, NestJS
- MariaDB (Docker로 실행), TypeORM
- socket.io
- OpenAPI (`@nestjs/swagger`)

## 문서

- [docs/api.md](docs/api.md): REST API, 응답 형식, 세션 상태와 이벤트
- [docs/db.md](docs/db.md): 테이블 설계
- [docs/todo.md](docs/todo.md): 구현 순서 투두. 이 순서대로 작업하고, 끝난 항목은 체크한다.

설계를 바꾸는 작업을 하면 해당 문서도 함께 수정한다.

## 명령어

```bash
cp .env.example .env     # 최초 1회
docker compose up -d     # MariaDB 실행 (UTC, utf8mb4)
npm run migration:run    # 마이그레이션 적용
npm run start:dev        # 개발 서버 (http://localhost:3000)
npm run lint             # ESLint
npm run test             # 단위 테스트
npm run test:e2e         # e2e 테스트
npm run migration:generate -- src/database/migrations/<Name>   # 엔티티 변경 후 마이그레이션 생성
```

Swagger UI는 `/docs`, OpenAPI JSON은 `/docs-json`에서 확인한다.

NestJS 11 기준이다. `@nestjs/*` 패키지를 추가할 때는 11과 호환되는 버전을 지정한다(예: `@nestjs/swagger@^11`).

## 아키텍처 규칙

반드시 지켜야 하는 설계 결정이다. 바꿔야 한다면 먼저 사용자와 논의한다.

1. **쓰기는 REST로만 받는다.** 메시지, join, leave, end는 모두 REST 엔드포인트로 들어온다(leave는 `POST /sessions/{id}/events`의 `PARTICIPANT_LEFT`). socket으로는 메시지를 받지 않는다.
2. **예외는 presence뿐이다.** socket 연결/끊김에서 생기는 `PRESENCE_ONLINE` / `PRESENCE_OFFLINE`은 Gateway가 `EventService`를 직접 호출해 저장한다.
3. **모든 이벤트 저장은 `EventService` 한 곳에서 한다.** Controller와 Gateway는 이벤트 테이블이나 프로젝션 테이블에 직접 쓰지 않는다.
4. **정식 순서는 세션별 `seq`다.** 세션 행을 `SELECT ... FOR UPDATE`로 잠근 뒤 `last_seq + 1`을 부여한다. `client_sent_at`은 정렬이나 복원에 쓰지 않는다.
5. **중복은 `clientEventId`로 막는다.** 이미 저장된 키면 새로 저장하지 않고 기존 이벤트를 돌려준다.
6. **이벤트와 프로젝션은 한 트랜잭션에서 저장한다.** 이벤트 로그인 `messages`(채팅 + 시스템 메시지)는 append-only이며 UPDATE/DELETE하지 않는다.
7. **broadcast는 커밋 후에 한다.**
8. **상태 전이는 순수 함수 reducer에 둔다.** `reduce(state, event) → state`를 실시간 처리, 프로젝션 갱신, 타임라인 복원이 함께 사용한다. reducer에는 DB나 시계 접근을 넣지 않는다.

## 도메인 요약

- 세션 상태: `JOIN`(진행중, 생성 시 생성자 자동 참여) → `LEAVE`(중단, leave 시) → `END`(완료, end 시). 생성, leave, end로만 바뀐다.
- presence(`ONLINE` / `OFFLINE`)는 참여자별 상태이며 세션 상태에 영향을 주지 않는다.
- 참여자는 최대 2명이다.
- 테이블: `sessions`, `participants`, `messages`, `snapshots`. 모든 이벤트는 `messages`에 시스템 메시지로 함께 저장한다.
- 이벤트 타입: `SESSION_CREATED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `MESSAGE_CREATED`, `PRESENCE_ONLINE`, `PRESENCE_OFFLINE`, `SESSION_ENDED`

## 모듈 구성 (예정)

```
src/
  session/      SessionController, 세션 조회/목록, 상태 reducer
  event/        EventService(단일 쓰기 경로), 이벤트 엔티티/리포지토리
  projection/   스냅샷, 타임라인 복원
  realtime/     ChatGateway(구독, presence), Broadcaster(전달만 담당)
  common/       에러 코드, 사용자 식별, 공통 DTO
```

## 코딩 규칙

- 도메인별로 모듈 - 컨트롤러 - 서비스 - 레포지토리 계층으로 나눈다. 컨트롤러는 요청 검증과 응답, 서비스는 비즈니스 로직과 트랜잭션, 레포지토리는 DB 접근(쿼리)만 맡는다.
- 계층 간 데이터 전달은 DTO로 한다. 컨트롤러는 엔티티를 그대로 응답하지 않는다. DB 스키마는 엔티티로 정의하고, 엔티티는 서비스와 레포지토리 사이에서만 사용한다.
- 도메인 폴더 구조: `<domain>.module.ts`, `<domain>.controller.ts`, `<domain>.service.ts`, `<domain>.repository.ts`, `dto/`, `entities/`
- 시각은 UTC로 다루고 DB에는 `DATETIME(3)`으로 저장한다.
- 엔티티는 각 도메인 모듈의 `entities/*.entity.ts`에 두고 `TypeOrmModule.forFeature()`로 등록한다(`autoLoadEntities`).
- 스키마는 TypeORM 마이그레이션으로만 바꾼다(`synchronize: false`). 엔티티를 바꾸면 마이그레이션을 생성하고 `docs/db.md`도 함께 고친다.
- 응답은 성공 `{ success: true, data }`, 실패 `{ success: false, code, message }`로 통일한다. 에러 코드는 `docs/api.md`의 목록을 따른다.
- 모든 REST 엔드포인트에 OpenAPI 데코레이터로 요청/응답 스키마를 명시한다.
- 핵심 로직은 유닛 테스트로 검증한다. reducer, 중복 처리, seq 부여, 스냅샷 기록 조건, 타임라인 복원은 반드시 테스트를 작성한다.
