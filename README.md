# chatting

1:1 참여자 간 실시간 채팅 서비스. 세션 단위로 이벤트를 기록하고, 이벤트를 다시 적용해 특정 시점의 세션 상태를 복원한다.

상세 설계는 [docs/api.md](docs/api.md)(API), [docs/db.md](docs/db.md)(테이블)를 참고한다.

## 실행 방법

```bash
npm install
cp .env.example .env     # 최초 1회
docker compose up -d     # MariaDB 실행
npm run migration:run    # 테이블 생성 (마이그레이션 적용)
npm run start:dev        # 개발 서버 (http://localhost:3000)
```

| 경로 | 내용 |
|---|---|
| `http://localhost:3000/docs` | Swagger UI |
| `http://localhost:3000/docs-json` | OpenAPI JSON |

요청 헤더 `X-User-Id`로 사용자를 식별한다(임시). Swagger UI에서는 Authorize에 값을 넣는다.

**기타 명령어**

```bash
npm run lint             # ESLint
npm run test             # 단위 테스트
npm run test:e2e         # e2e 테스트 (MariaDB 실행 필요)
npm run migration:generate -- src/database/migrations/<Name>   # 엔티티 변경 후 마이그레이션 생성
npm run migration:revert # 마지막 마이그레이션 되돌리기
docker compose down      # MariaDB 중지 (데이터 유지)
docker compose down -v   # MariaDB 중지 + 데이터 삭제
```

## 환경 구성

| 구성 | 내용 |
|---|---|
| 언어 / 프레임워크 | TypeScript, NestJS 11 |
| 런타임 | Node.js 20 이상 |
| DB | MariaDB 11.4 (Docker), InnoDB, utf8mb4, UTC |
| ORM | TypeORM (스키마는 마이그레이션으로 관리, `synchronize` 미사용) |
| 실시간 | socket.io (namespace `/chat`) |
| API 문서 | OpenAPI (`@nestjs/swagger`) |

**환경 변수** (`.env`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `DB_HOST` | `localhost` | DB 호스트 |
| `DB_PORT` | `3306` | DB 포트 |
| `DB_NAME` | `chatting` | DB 이름 |
| `DB_USER` | `chatting` | DB 사용자 |
| `DB_PASSWORD` | `chatting` | DB 비밀번호 |
| `DB_ROOT_PASSWORD` | `root` | MariaDB root 비밀번호 (컨테이너 초기화용) |

## 주요 의사결정 요약

### 애플리케이션 구성

도메인별로 모듈 - 컨트롤러 - 서비스 - 레포지토리 계층으로 나눈다.

| 계층 | 역할 |
|---|---|
| Module | 도메인 단위로 컨트롤러, 서비스, 레포지토리를 묶는다. 엔티티는 `TypeOrmModule.forFeature()`로 등록한다. |
| Controller | HTTP 요청을 받아 요청 DTO로 검증하고, 서비스를 호출해 응답 DTO로 돌려준다. |
| Service | 비즈니스 로직과 트랜잭션을 처리한다. |
| Repository | 엔티티로 DB에 접근한다. 쿼리는 이 계층에만 둔다. |

- 계층 간 데이터 전달은 DTO로 한다. 컨트롤러는 엔티티를 그대로 응답하지 않는다.
- DB 스키마는 엔티티로 정의하고, 엔티티는 서비스와 레포지토리 사이에서만 사용한다.

```
src/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.repository.ts
  dto/        요청/응답 DTO
  entities/   TypeORM 엔티티 (DB 스키마)
```

### 이벤트 기록과 상태 복원

- 모든 변화(생성, 참여, 나가기, 메시지, presence, 종료)를 `messages` 테이블에 이벤트로 append-only 저장한다. 채팅 메시지와 시스템 메시지를 `type`으로 구분한다.
- `sessions`, `participants`는 이벤트를 적용한 현재 상태(프로젝션)다. 이벤트와 프로젝션은 한 트랜잭션에서 저장한다.
- 상태 전이는 순수 함수 reducer(`reduce(state, event) → state`) 하나로 처리한다. 실시간 처리, 프로젝션 갱신, 타임라인 복원이 같은 reducer를 쓴다.
- 특정 시점 복원(`GET /sessions/{id}/timeline?at=`)은 가장 가까운 스냅샷에서 이후 이벤트를 다시 적용한다. 스냅샷은 상태 변경(join/leave/end) 시와 100개 이벤트마다 같은 트랜잭션에서 자동 기록한다.

### 중복 이벤트 방지 (제약 2.1)

- 클라이언트가 이벤트마다 UUID(`clientEventId`)를 한 번 만들고, 재전송할 때 같은 값을 보낸다. 서버가 발급하지 않는 이유는 "저장됐지만 응답이 유실된" 재전송을 첫 요청과 연결하려면 키가 요청 전에 있어야 하기 때문이다.
- 세션 행을 잠근 뒤 중복을 확인하고, `(session_id, client_event_id)` UNIQUE를 마지막 안전장치로 둔다.
- 중복이면 새로 저장하지 않고 `200`으로 기존 이벤트를 돌려주며, 다시 broadcast하지 않는다.
- 중복 확인을 상태 검증보다 먼저 한다. 이미 저장된 메시지의 재전송은 그 사이 세션이 종료됐어도 성공으로 응답한다.
- join, end는 상태 기준으로 멱등하다(이미 참여/종료면 `200`).

### 순서 처리 기준 (제약 2.2)

- 정식 순서는 서버가 세션별로 부여하는 `seq`다. 세션 행을 `SELECT ... FOR UPDATE`로 잠근 뒤 `last_seq + 1`을 부여해 동시 요청을 직렬화한다.
- 클라이언트 시각(`clientSentAt`)은 기기마다 달라 정렬과 복원에 쓰지 않는다.
- 늦게 도착한 이벤트는 도착 순서대로 seq를 받으며, 과거 순서에 끼워 넣지 않는다.

### 쓰기 경로와 실시간 전달

- 메시지, join, leave, end 등 쓰기는 REST로만 받는다. socket은 커밋된 이벤트를 전달하는 수신 채널이다.
- 예외는 presence다. socket 구독 시 `PRESENCE_ONLINE`, 해당 세션 연결이 모두 끊기면 `PRESENCE_OFFLINE`을 저장한다.
- 모든 이벤트 저장은 `EventService` 한 곳에서 하고, broadcast는 커밋 후에 한다.

### 세션 규칙

- 상태: `JOIN`(진행중) → `LEAVE`(중단, 참여자가 나감) → `END`(완료). `JOIN`에서 바로 `END`도 가능하다.
- 생성자는 세션 생성 시 자동으로 참여한다. 참여자는 최대 2명이며, 나간 사용자는 다시 참여할 수 없다.
- 종료는 참여 중인 사용자만 할 수 있다.

### 범위에서 제외한 것

- 인증/인가: `X-User-Id` 헤더로 임시 식별하며, 사용자 테이블을 두지 않는다.
- 세션 생성 요청의 중복 방지, 이벤트 조회 API, 다중 인스턴스 presence 관리는 이후 검토한다.
