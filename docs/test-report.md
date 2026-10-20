# 테스트 결과 리포트

`docs/todo.md` 항목별 테스트 결과를 기록한다. 항목을 끝낼 때마다 아래에 추가하고, 테스트가 없는 항목은 적지 않는다.

## 테스트 구성

| 종류 | 명령 | 위치 | DB |
|---|---|---|---|
| 단위 | `npm run test` | `src/**/*.spec.ts` | 사용 안 함 (리포지토리는 mock) |
| 통합 | `npm run test:int` | `test/*.int-spec.ts` | 테스트 DB `chatting_test` |
| e2e | `npm run test:e2e` | `test/*.e2e-spec.ts` | 테스트 DB `chatting_test` |
| 커버리지 | `npm run test:cov` | 단위 테스트 기준 | — |

- 통합/e2e 테스트는 시작할 때 `chatting_test`를 만들고(없으면) 마이그레이션을 적용한다(`test/setup/global-setup.ts`). 개발 DB(`chatting`)는 건드리지 않는다.
- 통합 테스트는 각 테스트 전에 테이블을 비운다.

## 최신 결과 요약

기준: 2026-10-20, 5단계 `POST /sessions/{id}/events` 완료

| 종류 | 결과 |
|---|---|
| 단위 | 88 / 88 통과 (9개 파일) |
| 통합 | 13 / 13 통과 (2개 파일) |
| e2e | 47 / 47 통과 (2개 파일) |
| lint, build | 통과 |

### 커버리지 (핵심 로직)

| 파일 | 단위 라인 | 단위 분기 | 통합 라인 | 비고 |
|---|---|---|---|---|
| `session/session.reducer.ts` | 100% | 98% | — | 남은 분기: 참여 시각이 같을 때 userId 정렬 |
| `event/event.service.ts` | 100% | 94% | — | 남은 분기: 방어 코드(`?? JOIN`, presence 외 분기) |
| `event/event.repository.ts` | 35% | 0% | **100%** | 단위에서는 mock, 쿼리는 통합 테스트에서 실행 |
| `projection/snapshot-policy.ts` | 100% | 100% | — | |
| `projection/projection.service.ts` | 100% | 90% | — | |
| `projection/projection.repository.ts` | 50% | 60% | **100%** | 단위에서는 mock, 쿼리는 통합 테스트에서 실행 |
| `common/errors/http-exception.filter.ts` | 83% | 80% | — | `catch()`의 응답 쓰기는 e2e에서 실행 |
| `common/pipes/validation.pipe.ts` | 100% | 75% | — | |
| `common/decorators/user-id.decorator.ts` | 93% | 100% | — | 파라미터 데코레이터 본체는 5단계 API에서 사용 |

전체(`All files`) 단위 라인 커버리지는 65%다. 마이그레이션, 모듈, 설정, Swagger DTO처럼 단위 테스트 대상이 아닌 파일이 포함된 수치다.

---

## 1단계. common

### 요청 검증 (`ValidationPipe`) — 단위 3
- 올바른 요청은 DTO 인스턴스로 변환한다.
- 검증 실패는 `VALIDATION_ERROR` `AppException`으로 바뀌고, 메시지에 실패한 필드가 들어간다.
- 정의되지 않은 필드는 거절한다(`forbidNonWhitelisted`).

### 응답 형식 (`{ success: true, data }`) — e2e 1
- `GET /` 응답이 `{ success: true, data: 'Hello World!' }`로 감싸진다.

### 에러 형식 (`{ success: false, code, message }`) — 단위 5, e2e 1
- `AppException`은 에러 코드에 정의된 HTTP 상태와 메시지를 쓰고, 메시지를 덮어쓸 수 있다.
- 프레임워크의 400은 `VALIDATION_ERROR`, 없는 경로의 404는 `NOT_FOUND`가 된다.
- 알 수 없는 에러는 내부 메시지를 숨기고 `500 INTERNAL_ERROR`가 된다.
- e2e: 없는 경로 요청이 공통 에러 형식으로 응답한다.

### 사용자 식별 (`X-User-Id`) — 단위 6
- 헤더 값의 앞뒤 공백을 제거한다.
- 없음, 빈 문자열, 공백만, 헤더가 여러 개인 경우 `UNAUTHORIZED`.
- 64자는 허용하고 65자는 `VALIDATION_ERROR`.

## 3단계. event

### `messages` 엔티티 + 마이그레이션 — 통합 1
- 저장한 이벤트를 다시 읽으면 처음 응답과 같다. JSON payload, BIGINT(number), `DATETIME(3)` 밀리초, utf8mb4(이모지)가 그대로 유지된다.
- 수동 확인: 마이그레이션 적용 → 되돌리기 → 재적용, 엔티티와 DB 스키마 차이 없음(`migration:generate --dryrun`).

### reducer — 단위 30
- `SESSION_CREATED`는 빈 상태를 `JOIN`으로 만들고, 두 번 적용하거나 생성 전에 다른 이벤트를 적용할 수 없다.
- 입력 상태를 바꾸지 않는다(순수 함수).
- `PARTICIPANT_JOINED`: OFFLINE으로 추가, 세 번째는 `SESSION_FULL`, 나간 사용자는 `ALREADY_LEFT`, `LEAVE`/`END` 세션은 `INVALID_SESSION_STATUS`.
- `MESSAGE_CREATED`: 메시지 수와 마지막 메시지 갱신, 비참여자 `NOT_PARTICIPANT`, 나간 참여자 `ALREADY_LEFT`, `LEAVE`/`END` 세션 거절.
- `PARTICIPANT_LEFT`: `JOIN` → `LEAVE`와 `leftAt` 기록, `LEAVE`에서 남은 참여자도 나갈 수 있음, `END`에서는 거절.
- `SESSION_ENDED`: `JOIN`/`LEAVE` → `END`, 나간 참여자나 비참여자는 `NOT_PARTICIPANT`, 재종료 거절.
- presence: 세션 상태와 무관하게 참여자의 presence만 바뀐다. `END` 세션과 나간 참여자도 기록할 수 있다.
- `isAlreadyApplied`: 재참여, 재퇴장, 재종료(참여 중인 사용자)만 멱등으로 판단하고, 메시지와 presence는 상태로 판단하지 않는다.

**발견한 결함:** 나간 사용자의 재참여가 `ALREADY_LEFT`가 아닌 `INVALID_SESSION_STATUS`로 응답했다. 누가 나가면 세션이 먼저 `LEAVE`가 되기 때문이었다. 검사 순서를 바꿔 api.md와 맞췄다.

### `EventService` 단일 쓰기 경로 — 단위 16, 통합 6
단위:
- 잠근 세션의 `last_seq + 1`을 seq로 부여하고 이벤트 공통 형식으로 돌려준다.
- 이벤트와 같은 트랜잭션에서 세션 프로젝션(상태, `last_seq`, 메시지 수, 마지막 메시지)을 갱신한다.
- 이미 저장된 `clientEventId`면 저장하지 않고 기존 이벤트를 돌려준다(`created: false`).
- 중복 확인은 세션 잠금 뒤, 상태 검증 전에 한다. `END` 세션에도 기존 이벤트를 돌려준다.
- 상태 검증에 실패하면 아무것도 저장하지 않는다. 세션이 없으면 `SESSION_NOT_FOUND`.
- 재참여, 재종료는 기존 이벤트를 돌려준다. 재종료는 행위자와 무관하게 찾는다.
- leave/end/presence의 프로젝션 갱신(`leftAt`, `ended_at`, `presence_at`).
- 세션 생성: seq 1 `SESSION_CREATED` + seq 2 생성자 `PARTICIPANT_JOINED`, 세션 ID는 UUID v7.

통합 (실제 MariaDB):
- 동시에 들어온 메시지 20건에 빈틈과 중복 없이 seq 4~23을 부여한다.
- 같은 `clientEventId` 요청 5건이 동시에 와도 1건만 저장되고 모두 같은 이벤트를 받는다.
- 여러 종류의 이벤트를 거친 뒤 `sessions`/`participants` 프로젝션이 이벤트 전체 재적용 결과와 같다.
- 멱등 요청(재참여, 재종료)은 새 이벤트를 만들지 않는다.
- 상태 검증에 실패한 트랜잭션은 아무것도 남기지 않는다.

**변이 검증:** 세션 잠금(`pessimistic_write`)을 빼면 통합 테스트 2건(동시 seq, 동시 중복 키)이 실패한다.

## 4단계. projection

### `shouldSnapshot` 기록 조건 + `EventService` 연결 — 단위 16, 통합 3
단위:
- 참여/나가기/종료 이벤트는 seq와 무관하게 기록한다.
- 그 외 이벤트는 seq가 100의 배수일 때만 기록한다. `SESSION_CREATED`(seq 1)는 기록하지 않는다.
- 저장한 seq의 reducer 결과를 `createdAt = receivedAt`으로 기록한다.
- 중복 요청은 기록하지 않는다. 세션 생성은 seq 2만 기록한다.

통합:
- 스냅샷이 seq 2, 3(참여), 6(나가기), 7(종료)에만 남고, 각 스냅샷이 그 seq까지 재적용한 상태와 같다.
- 메시지로 seq 100을 채우면 타입과 무관하게 스냅샷이 남는다.
- 중복 요청과 실패한 요청은 스냅샷을 남기지 않는다.

### 타임라인 복원 — 단위 5, 통합 4
단위:
- `receivedAt ≤ at`인 이벤트 중 가장 큰 seq를 기준으로 삼는다.
- 스냅샷이 없으면 빈 상태에서 1번부터, 있으면 스냅샷 이후 이벤트만 적용한다. 스냅샷 객체는 바꾸지 않는다.
- 기준 seq에 스냅샷이 있으면 그대로 쓴다.
- 기준 이벤트가 없으면(세션 생성 이전, 없는 세션) `SESSION_NOT_FOUND`.

통합 (이벤트 104개, 스냅샷 seq 2, 3, 100, 103, 104):
- 모든 이벤트 시각에서 복원 결과가 처음부터 재적용한 결과와 같다.
- 스냅샷을 모두 지워도 복원 결과가 같다(스냅샷은 캐시).
- 마지막 이벤트 이후 시각은 현재 상태를 돌려준다.
- 세션 생성 이전 시각과 없는 세션은 `SESSION_NOT_FOUND`.

**변이 검증:** 스냅샷 이후 이벤트 범위를 한 칸 틀리게(`fromSeq + 1` → `fromSeq`) 바꾸면 통합 테스트 3건이 실패한다.

## 5단계. session (API)

### `POST /sessions` — 단위 3, e2e 16
단위 (`SessionService`, `EventService`·리포지토리 mock):
- 요청자를 생성자(`actorId`)로 `EventService.createSession`에 넘긴다.
- 커밋된 프로젝션을 세션 형식으로 바꾼다(시각은 ISO-8601, BIGINT `lastSeq`는 숫자).
- 저장이 실패하면 예외를 그대로 전파하고 조회하지 않는다.

e2e (실제 테스트 DB):
- `201`과 세션 형식을 돌려준다. ID는 UUID v7, `status = JOIN`, 참여자는 생성자 1명(`OFFLINE`), `lastSeq = 2`.
- `messages`에 seq 1 `SESSION_CREATED`, seq 2 `PARTICIPANT_JOINED`가 저장된다.
- 제목의 앞뒤 공백을 제거해 저장한다(가운데 공백은 유지). 제목 100자와 텍스트 기호(©, ™, ❤)는 허용한다.
- 제목 없음, 빈 제목, 공백만 있는 제목, 101자(공백 제거 후 기준), 문자열이 아닌 제목, 이모지(😀, ❤️, 🇰🇷, 1️⃣), 정의되지 않은 필드는 `400 VALIDATION_ERROR`이고 세션을 저장하지 않는다.
- `X-User-Id`가 없으면 `401 UNAUTHORIZED`.

### `POST /sessions/{id}/join` — 단위 1, e2e 8
단위:
- 요청자의 `PARTICIPANT_JOINED`를 `EventService.append`에 넘기고 결과(`event`, `created`)를 그대로 돌려준다.

e2e (실제 테스트 DB, 나가기는 REST, 종료 상태는 `EventService`로 만든다):
- 새로 참여하면 `201`과 seq 3 `PARTICIPANT_JOINED` 이벤트(이벤트 공통 형식)를 돌려주고 `participant_count`가 2가 된다.
- 이미 참여 중이면 `200`으로 기존 이벤트를 돌려주고 새로 저장하지 않는다. 생성자는 seq 2 이벤트를 받는다.
- 세 번째 사용자는 `409 SESSION_FULL`, 나간 사용자는 `409 ALREADY_LEFT`.
- `LEAVE`, `END` 세션에 새 사용자가 참여하면 `409 INVALID_SESSION_STATUS`.
- 없는 세션은 `404 SESSION_NOT_FOUND`, `X-User-Id`가 없으면 `401 UNAUTHORIZED`.

### `POST /sessions/{id}/events` — 단위 2, e2e 21
단위:
- 메시지는 `content`만 payload로 넘기고 `clientSentAt`을 `Date`로 바꾼다(오프셋 포함 시각도 UTC로).
- 나가기는 빈 payload로 넘기고, `clientSentAt`이 없으면 `null`.

e2e (실제 테스트 DB):
- 메시지를 저장하면 `201`과 이벤트(seq 4, `clientEventId`, `payload`, `clientSentAt`)를 돌려준다.
- 같은 `clientEventId`는 본문이 달라도 `200`으로 처음 이벤트를 돌려주고 새로 저장하지 않는다.
- 세션이 그 뒤 `END`가 돼도 저장된 키는 `200`이고, 저장된 적 없는 키는 `409 INVALID_SESSION_STATUS`(중복 확인이 상태 검증보다 먼저).
- 나가면 `201`, 세션은 `LEAVE`, 참여자 `left_at`이 기록된다. 이미 나간 사용자가 새 키로 다시 나가면 `200`으로 기존 이벤트.
- 나간 사용자의 메시지는 `409 ALREADY_LEFT`, 남은 사용자의 메시지는 `409 INVALID_SESSION_STATUS`.
- 참여자가 아니면 메시지와 나가기 모두 `403 NOT_PARTICIPANT`.
- 검증 실패 12가지(`clientEventId` 없음·UUID 아님, `type` 없음·`PARTICIPANT_JOINED`·`PRESENCE_ONLINE`, 메시지 payload 없음·빈 content·문자열 아닌 content·payload의 정의되지 않은 필드, 비어 있지 않은 나가기 payload, ISO-8601 아닌 `clientSentAt`, 정의되지 않은 필드)는 `400 VALIDATION_ERROR`이고 저장하지 않는다.
- 없는 세션은 `404 SESSION_NOT_FOUND`, `X-User-Id`가 없으면 `401 UNAUTHORIZED`.
