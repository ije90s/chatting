# DB 설계

MariaDB 기반 테이블 설계이다. API 명세는 [api.md](./api.md)를 참고한다.

## 1. 구성 개요

| 테이블 | 역할 | 성격 |
|---|---|---|
| `sessions` | 세션 현재 상태, 목록 조회용 | 프로젝션 |
| `participants` | 참여자별 현재 상태, presence | 프로젝션 |
| `messages` | 채팅 메시지와 시스템 메시지(입장, 퇴장, 종료, presence)의 원본 기록 | append-only, 사실의 원천 |
| `snapshots` | 특정 seq 시점의 상태 | 타임라인 복원 가속용 캐시 |

- `messages`는 이벤트 로그 역할을 한다. 채팅 본문(`MESSAGE_CREATED`)뿐 아니라 세션 상태와 presence를 바꾸는 시스템 메시지도 같은 테이블에 seq 순서로 저장한다. api.md와 코드에서 말하는 "이벤트"는 이 테이블의 한 행이다.
- 이벤트 저장과 프로젝션 갱신은 **같은 트랜잭션**에서 처리한다. 프로젝션이 이벤트보다 늦거나 앞서는 상황을 만들지 않는다.
- 프로젝션은 이벤트를 처음부터 다시 적용하면 언제든 재구성할 수 있어야 한다.

## 2. 공통 규칙

- 엔진 `InnoDB`, 문자셋 `utf8mb4`, collation `utf8mb4_unicode_ci`
- 시각은 `DATETIME(3)`, **UTC**로 저장한다. DB 연결의 time zone을 `+00:00`으로 고정한다.
- 시각 컬럼에는 DB 기본값(`CURRENT_TIMESTAMP`)을 쓰지 않는다. 애플리케이션이 이벤트의 `received_at`을 넣어 이벤트와 프로젝션의 시각을 일치시킨다.
- 세션 ID는 UUID v7(`CHAR(36)`)을 사용한다. 시간순으로 증가해 InnoDB 클러스터드 인덱스에 순서대로 들어간다. 이벤트 ID는 `BIGINT AUTO_INCREMENT`를 사용한다.
- `JSON` 타입은 MariaDB에서 `LONGTEXT`의 별칭이다. 형식 검증은 `CHECK (JSON_VALID(...))`와 애플리케이션 양쪽에서 한다.
- ORM은 TypeORM을 사용한다. 엔티티는 도메인 모듈별 `entities/*.entity.ts`에 두고 `TypeOrmModule.forFeature()`로 등록한다. 마이그레이션은 `src/database/migrations/`에 둔다. `synchronize`는 끄고 스키마는 마이그레이션으로만 바꾼다.

## 3. 테이블

### `sessions`

```sql
CREATE TABLE sessions (
  id               CHAR(36)        NOT NULL,
  title            VARCHAR(100)    NOT NULL,
  status           ENUM('JOIN', 'LEAVE', 'END') NOT NULL DEFAULT 'JOIN',
  created_by       VARCHAR(64)     NOT NULL,
  last_seq         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  participant_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  message_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  last_message_seq BIGINT UNSIGNED NULL,
  created_at       DATETIME(3)     NOT NULL,
  ended_at         DATETIME(3)     NULL,
  updated_at       DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_created (created_at, id),
  KEY idx_sessions_status_created (status, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

| 컬럼 | 설명 |
|---|---|
| `title` | 세션 제목. 목록에 표시한다. `SESSION_CREATED` payload에도 담아 이벤트만으로 복원할 수 있게 한다. |
| `last_seq` | seq 발급 카운터. 세션 행을 `SELECT ... FOR UPDATE`로 잠근 뒤 `last_seq + 1`을 다음 seq로 쓰고, messages INSERT와 같은 트랜잭션에서 갱신한다. 조회 시 클라이언트가 놓친 이벤트가 있는지 비교하는 기준도 된다. |
| `participant_count` | 현재까지 join한 인원(나간 사람 포함). 최대 2. |
| `message_count` | `MESSAGE_CREATED` 수. reducer 상태의 `messageCount` |
| `last_message_seq` | 마지막 `MESSAGE_CREATED`의 seq. 메시지가 없으면 NULL. reducer 상태의 `lastMessage`는 이 seq로 messages를 조회해 만든다. |

- 이벤트를 저장할 때 reducer에 넣을 현재 상태는 `sessions` + `participants` + 마지막 메시지 한 건으로 만든다. 쓰기마다 이벤트를 재적용하지 않는다.

### `participants`

```sql
CREATE TABLE participants (
  session_id   CHAR(36)    NOT NULL,
  user_id      VARCHAR(64) NOT NULL,
  joined_at    DATETIME(3) NOT NULL,
  left_at      DATETIME(3) NULL,
  presence     ENUM('ONLINE', 'OFFLINE') NOT NULL DEFAULT 'OFFLINE',
  presence_at  DATETIME(3) NULL,
  PRIMARY KEY (session_id, user_id),
  KEY idx_participants_user (user_id, session_id),
  CONSTRAINT fk_participants_session FOREIGN KEY (session_id) REFERENCES sessions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- `idx_participants_user`는 `GET /sessions?participantId=` 필터에 사용한다.
- 2명 제한은 세션 행 잠금 아래에서 `participant_count`로 검사한다.

### `messages`

채팅 메시지와 시스템 메시지를 함께 저장한다. `type`으로 구분한다.

```sql
CREATE TABLE messages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id       CHAR(36)        NOT NULL,
  seq              BIGINT UNSIGNED NOT NULL,
  type             VARCHAR(32)     NOT NULL,
  actor_id         VARCHAR(64)     NOT NULL,
  client_event_id  CHAR(36)        NULL,
  payload          JSON            NOT NULL DEFAULT '{}',
  client_sent_at   DATETIME(3)     NULL,
  received_at      DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_messages_session_seq (session_id, seq),
  UNIQUE KEY uk_messages_session_client_event (session_id, client_event_id),
  KEY idx_messages_session_received (session_id, received_at),
  CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES sessions (id),
  CONSTRAINT chk_messages_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

| 컬럼 | 설명 |
|---|---|
| `seq` | 세션 안에서의 정식 순서. 1부터 빈틈없이 증가한다. |
| `type` | 채팅: `MESSAGE_CREATED` / 시스템: `SESSION_CREATED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `PRESENCE_ONLINE`, `PRESENCE_OFFLINE`, `SESSION_ENDED` |
| `actor_id` | 이벤트를 일으킨 사용자. 생성은 생성자, presence는 연결/끊김이 일어난 사용자다. 모든 이벤트에 행위자가 있으므로 NULL을 허용하지 않는다. |
| `client_event_id` | 중복 방지 키. presence 등 서버가 만든 이벤트는 NULL (NULL은 UNIQUE 검사에서 서로 겹치지 않는다) |
| `client_sent_at` | 참고용. 정렬과 복원에 쓰지 않는다. |
| `received_at` | 서버 수신 시각. `timeline?at=` 기준 |

- `type`은 이벤트 종류가 늘어날 것을 고려해 `ENUM` 대신 `VARCHAR`로 두고 애플리케이션에서 검증한다.
- 이 테이블에는 `UPDATE`, `DELETE`를 하지 않는다.
- TypeORM은 MariaDB의 CHECK 제약을 생성하지 않으므로 `chk_messages_payload`는 마이그레이션에 직접 작성했다.

**타입별 payload**

| type | payload |
|---|---|
| `SESSION_CREATED` | `{ "title": "..." }` |
| `PARTICIPANT_JOINED` | `{}` |
| `PARTICIPANT_LEFT` | `{}` |
| `MESSAGE_CREATED` | `{ "content": "..." }` |
| `PRESENCE_ONLINE` | `{ "socketId": "..." }` |
| `PRESENCE_OFFLINE` | `{ "socketId": "...", "reason": "transport close" }` |
| `SESSION_ENDED` | `{}` |

### `snapshots`

```sql
CREATE TABLE snapshots (
  session_id  CHAR(36)        NOT NULL,
  seq         BIGINT UNSIGNED NOT NULL,
  state       JSON            NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (session_id, seq),
  CONSTRAINT fk_snapshots_session FOREIGN KEY (session_id) REFERENCES sessions (id),
  CONSTRAINT chk_snapshots_state CHECK (JSON_VALID(state))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- `state`는 reducer가 만드는 세션 상태(상태, 참여자, presence, 메시지 수, 마지막 메시지)를 그대로 저장한다. 메시지 목록 전체는 넣지 않는다.
- messages로 언제든 다시 만들 수 있는 캐시다. 지워도 복원 결과는 같고 속도만 달라진다.

**기록 시점**: 아래 이벤트를 저장한 직후, 같은 트랜잭션에서 그 seq의 reducer 결과를 저장한다.

| 조건 | 대상 |
|---|---|
| 세션/참여 상태 변경 | `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `SESSION_ENDED` |
| 100개마다 | `seq % 100 = 0`인 이벤트 (타입 무관) |

- 두 조건이 같은 seq에서 겹쳐도 PK `(session_id, seq)`이므로 한 행만 저장한다.
- `SESSION_CREATED`(seq 1)는 빈 상태와 거의 같으므로 기록하지 않는다. presence 이벤트는 100개 조건에 걸릴 때만 기록된다.
- 기록 조건 판단은 순수 함수(`shouldSnapshot(event)`)로 두고 테스트한다.

## 4. 미결 사항

- [x] ORM 선택 및 마이그레이션 방식 → TypeORM, 엔티티 변경 후 `migration:generate`로 생성하고 `migration:run`으로 적용
- [x] 세션 ID 형식 → UUID v7, `CHAR(36)`. 삽입 위치가 순차적이고 조회 시 읽기 쉽다. `BINARY(16)`은 변환 비용 대비 이득이 작아 쓰지 않는다.
- [x] 사용자 테이블 도입 여부 → 도입하지 않는다. 인증/인가는 요구사항 범위 밖이므로 `user_id` 문자열만 저장하고 FK를 걸지 않는다.
- [x] 스냅샷 기록 시점 → 상태 변경 시 + 100개마다 (3장)
- [ ] 메시지 보관 기간, 삭제/수정 메시지 지원 여부
