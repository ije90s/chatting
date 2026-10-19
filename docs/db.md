# DB 설계 (초안)

MariaDB 기반 테이블 설계 초안이다. API 명세는 [api.md](./api.md)를 참고한다.

## 1. 구성 개요

| 테이블 | 역할 | 성격 |
|---|---|---|
| `session_events` | 모든 이벤트의 원본 기록 | append-only, 사실의 원천 |
| `sessions` | 세션 현재 상태, 목록 조회용 | 프로젝션 |
| `session_participants` | 참여자별 현재 상태, presence | 프로젝션 |
| `session_snapshots` | 특정 seq 시점의 상태 | 타임라인 복원 가속용 (선택) |

- 이벤트 저장과 프로젝션 갱신은 **같은 트랜잭션**에서 처리한다. 프로젝션이 이벤트보다 늦거나 앞서는 상황을 만들지 않는다.
- 프로젝션은 이벤트를 처음부터 다시 적용하면 언제든 재구성할 수 있어야 한다.

## 2. 공통 규칙

- 엔진 `InnoDB`, 문자셋 `utf8mb4`, collation `utf8mb4_unicode_ci`
- 시각은 `DATETIME(3)`, **UTC**로 저장한다. DB 연결의 time zone을 `+00:00`으로 고정한다.
- 세션 ID는 UUID(`CHAR(36)`)를 사용한다. 이벤트 ID는 `BIGINT AUTO_INCREMENT`를 사용한다.
- `JSON` 타입은 MariaDB에서 `LONGTEXT`의 별칭이다. 형식 검증은 `CHECK (JSON_VALID(...))`와 애플리케이션 양쪽에서 한다.

## 3. 테이블

### `sessions`

```sql
CREATE TABLE sessions (
  id               CHAR(36)        NOT NULL,
  status           ENUM('ACTIVE', 'INTERRUPTED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
  created_by       VARCHAR(64)     NOT NULL,
  last_seq         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  participant_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  message_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  last_message_at  DATETIME(3)     NULL,
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
| `last_seq` | 마지막으로 부여한 seq. 다음 이벤트는 `last_seq + 1`을 받는다. |
| `participant_count` | 현재까지 join한 인원(나간 사람 포함). 최대 2. |
| `message_count`, `last_message_at` | 목록 표시용 집계 |

### `session_participants`

```sql
CREATE TABLE session_participants (
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
- 2명 제한은 세션 행 잠금 아래에서 `participant_count`로 검사한다(4장).

### `session_events`

```sql
CREATE TABLE session_events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id       CHAR(36)        NOT NULL,
  seq              BIGINT UNSIGNED NOT NULL,
  type             VARCHAR(32)     NOT NULL,
  actor_id         VARCHAR(64)     NULL,
  client_event_id  CHAR(36)        NULL,
  payload          JSON            NOT NULL DEFAULT '{}',
  client_sent_at   DATETIME(3)     NULL,
  received_at      DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_events_session_seq (session_id, seq),
  UNIQUE KEY uk_events_session_client_event (session_id, client_event_id),
  KEY idx_events_session_received (session_id, received_at),
  CONSTRAINT fk_events_session FOREIGN KEY (session_id) REFERENCES sessions (id),
  CONSTRAINT chk_events_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

| 컬럼 | 설명 |
|---|---|
| `seq` | 세션 안에서의 정식 순서. 1부터 빈틈없이 증가한다. |
| `type` | `SESSION_CREATED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `MESSAGE_CREATED`, `PRESENCE_ONLINE`, `PRESENCE_OFFLINE`, `SESSION_ENDED` |
| `actor_id` | 이벤트를 일으킨 사용자. 시스템 이벤트면 NULL |
| `client_event_id` | 중복 방지 키. presence 등 서버가 만든 이벤트는 NULL (NULL은 UNIQUE 검사에서 서로 겹치지 않는다) |
| `client_sent_at` | 참고용. 정렬과 복원에 쓰지 않는다. |
| `received_at` | 서버 수신 시각. `timeline?at=` 기준 |

- `type`은 이벤트 종류가 늘어날 것을 고려해 `ENUM` 대신 `VARCHAR`로 두고 애플리케이션에서 검증한다.
- 이 테이블에는 `UPDATE`, `DELETE`를 하지 않는다.

**타입별 payload**

| type | payload |
|---|---|
| `SESSION_CREATED` | `{}` |
| `PARTICIPANT_JOINED` | `{}` |
| `PARTICIPANT_LEFT` | `{}` |
| `MESSAGE_CREATED` | `{ "content": "..." }` |
| `PRESENCE_ONLINE` | `{ "socketId": "..." }` |
| `PRESENCE_OFFLINE` | `{ "socketId": "...", "reason": "transport close" }` |
| `SESSION_ENDED` | `{}` |

### `session_snapshots` (선택)

```sql
CREATE TABLE session_snapshots (
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
- 1:1 세션은 이벤트 수가 적어서 1차 구현에서는 스냅샷 없이 전체 재생으로 복원한다. 테이블과 조회 인터페이스만 준비해 둔다.
- 도입 시 생성 시점 후보: 100개 이벤트마다, 또는 세션 상태가 바뀔 때.

## 4. 쓰기 흐름

모든 이벤트 저장은 `EventService`의 한 트랜잭션에서 아래 순서로 처리한다.

```sql
BEGIN;

-- 1. 세션 행 잠금: 같은 세션의 쓰기를 직렬화한다
SELECT * FROM sessions WHERE id = ? FOR UPDATE;

-- 2. 중복 확인: 이미 있으면 기존 이벤트를 돌려주고 종료
SELECT * FROM session_events WHERE session_id = ? AND client_event_id = ?;

-- 3. 상태 검증 (애플리케이션): reducer로 현재 상태에서 이 이벤트가 허용되는지 확인

-- 4. 이벤트 저장
INSERT INTO session_events (session_id, seq, type, ..., received_at)
VALUES (?, last_seq + 1, ?, ..., NOW(3));

-- 5. 프로젝션 갱신
UPDATE sessions SET last_seq = last_seq + 1, status = ?, ... WHERE id = ?;
INSERT/UPDATE session_participants ...;

COMMIT;

-- 6. 커밋 후 socket room으로 broadcast
```

- 중복 확인을 잠금 뒤에 하므로 같은 `clientEventId` 두 요청이 동시에 와도 하나만 저장된다. `uk_events_session_client_event`는 마지막 안전장치다.
- 세션 단위로만 잠그므로 서로 다른 세션의 쓰기는 서로 막지 않는다.
- `received_at`은 잠금 안에서 기록하므로 seq 순서와 대체로 같은 방향으로 증가한다. 서버 시계가 뒤로 가는 경우를 대비해 복원 기준은 항상 seq로 한다.

## 5. 주요 조회

**세션 목록 (상태 + 참여자 필터, 커서)**
```sql
SELECT s.*
FROM sessions s
JOIN session_participants p ON p.session_id = s.id AND p.user_id = ?
WHERE s.status IN (?)
  AND s.created_at BETWEEN ? AND ?
  AND (s.created_at, s.id) < (?, ?)   -- cursor
ORDER BY s.created_at DESC, s.id DESC
LIMIT ?;
```

**놓친 이벤트 조회**
```sql
SELECT * FROM session_events
WHERE session_id = ? AND seq > ?
ORDER BY seq
LIMIT ?;
```

**타임라인: 기준 seq 찾기**
```sql
SELECT MAX(seq) FROM session_events
WHERE session_id = ? AND received_at <= ?;
```

**타임라인: 스냅샷 + 이후 이벤트**
```sql
SELECT * FROM session_snapshots
WHERE session_id = ? AND seq <= ?
ORDER BY seq DESC LIMIT 1;

SELECT * FROM session_events
WHERE session_id = ? AND seq > ? AND seq <= ?
ORDER BY seq;
```

## 6. 로컬 환경

```yaml
# docker-compose.yml (예정)
services:
  mariadb:
    image: mariadb:11.4
    environment:
      MARIADB_DATABASE: chatting
      MARIADB_USER: chatting
      MARIADB_PASSWORD: chatting
      MARIADB_ROOT_PASSWORD: root
      TZ: UTC
    command: --default-time-zone=+00:00 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    ports:
      - "3306:3306"
```

## 7. 미결 사항

- [ ] ORM 선택 (TypeORM / Prisma / MikroORM) 및 마이그레이션 방식
- [ ] 세션 ID 형식 (UUID v4 / v7, `CHAR(36)` / `BINARY(16)`)
- [ ] 사용자 테이블 도입 여부 (현재는 `user_id` 문자열만 저장)
- [ ] 스냅샷 도입 시점과 주기
- [ ] 메시지 보관 기간, 삭제/수정 메시지 지원 여부
