# API 설계 (초안)

1:1 실시간 채팅 서비스의 REST API와 socket.io 이벤트 명세 초안이다.
세부 프로토콜은 요구사항 문서를 받은 뒤 확정하며, 이 문서는 현재까지 결정된 설계를 기준으로 한다.

## 1. 설계 원칙

| 원칙 | 내용 |
|---|---|
| 쓰기 경로는 REST | 메시지, join, leave, end 등 모든 쓰기는 REST로 들어온다. 예외는 presence뿐이다(4장 참고). |
| socket은 수신 채널 | 저장이 끝난 이벤트를 room으로 전달하고, 연결 상태로 presence를 감지한다. |
| 단일 쓰기 서비스 | REST Controller와 Socket Gateway는 모두 `EventService`를 통해서만 이벤트를 저장한다. |
| 순서 기준은 seq | 서버가 세션별로 부여하는 `seq`가 유일한 정식 순서다. 클라이언트 시각은 참고용이다. |
| 중복 방지 | 클라이언트가 보내는 `clientEventId`로 같은 이벤트가 두 번 저장되지 않게 한다. |
| 커밋 후 전달 | 트랜잭션 커밋이 끝난 뒤에 broadcast한다. |

## 2. 공통 규칙

### 사용자 식별 (임시)

인증 체계가 정해지기 전까지는 요청 헤더로 사용자를 식별한다.

```
X-User-Id: user-a
```

socket은 handshake의 `auth.userId`를 사용한다(4장).

### 시간 형식

- 모든 시각은 ISO-8601 UTC, 밀리초까지 표기한다. 예: `2026-10-19T06:20:00.123Z`
- 응답의 `receivedAt`은 서버 수신 시각이다. `clientSentAt`은 클라이언트가 보낸 값을 그대로 돌려준다.

### 에러 응답

```json
{
  "code": "SESSION_NOT_ACTIVE",
  "message": "세션이 진행중 상태가 아닙니다."
}
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 요청 형식 오류 |
| 401 | `UNAUTHORIZED` | 사용자 식별 정보 없음 |
| 403 | `NOT_PARTICIPANT` | 세션 참여자가 아닌 사용자의 요청 |
| 404 | `SESSION_NOT_FOUND` | 세션 없음 |
| 409 | `SESSION_FULL` | 참여자가 이미 2명 |
| 409 | `SESSION_NOT_ACTIVE` | 진행중이 아닌 세션에 쓰기 요청 |
| 409 | `ALREADY_LEFT` | 이미 나간 참여자가 다시 요청 |

## 3. 세션 상태와 이벤트

### 세션 상태 (리스트 표시용)

| 상태 | 의미 | 진입 조건 |
|---|---|---|
| `ACTIVE` (진행중) | 대화 진행 가능 | 세션 생성 |
| `INTERRUPTED` (중단) | 정상 종료 없이 참여자가 나감 | `ACTIVE`에서 leave |
| `COMPLETED` (완료) | 정상 종료 | `ACTIVE` 또는 `INTERRUPTED`에서 end |

```
ACTIVE ──(leave)──▶ INTERRUPTED
  │                     │
  └──(end)──▶ COMPLETED ◀──(end)
```

- 세션 상태는 join, leave, end로만 바뀐다.
- online/offline은 참여자별 presence로 따로 관리하며, 세션 상태에 영향을 주지 않는다.
- 메시지와 join은 `ACTIVE`에서만 허용한다.

### 이벤트 타입

| 타입 | 발생 경로 | 세션 상태 변화 |
|---|---|---|
| `SESSION_CREATED` | `POST /sessions` | → `ACTIVE` |
| `PARTICIPANT_JOINED` | `POST /sessions/{id}/join` | 없음 |
| `PARTICIPANT_LEFT` | `POST /sessions/{id}/leave` | `ACTIVE` → `INTERRUPTED` |
| `MESSAGE_CREATED` | `POST /sessions/{id}/events` | 없음 |
| `PRESENCE_ONLINE` | socket 구독 시작 | 없음 |
| `PRESENCE_OFFLINE` | socket 연결 끊김 | 없음 |
| `SESSION_ENDED` | `POST /sessions/{id}/end` | → `COMPLETED` |

재연결은 별도 타입을 두지 않는다. `PRESENCE_OFFLINE` 뒤에 오는 `PRESENCE_ONLINE`이 재연결이다.

### 이벤트 공통 형식

REST 응답과 socket 전달에서 같은 형식을 사용한다.

```json
{
  "eventId": 1024,
  "sessionId": "0192a3b4-...",
  "seq": 7,
  "type": "MESSAGE_CREATED",
  "actorId": "user-a",
  "clientEventId": "6f1c...",
  "payload": { "content": "안녕하세요" },
  "clientSentAt": "2026-10-19T06:20:00.100Z",
  "receivedAt": "2026-10-19T06:20:00.123Z"
}
```

## 4. REST API

### `POST /sessions` 세션 생성

요청한 사용자가 생성자로 기록된다. 생성자도 참여하려면 `join`을 호출한다.

**Response 201**
```json
{
  "id": "0192a3b4-...",
  "status": "ACTIVE",
  "createdBy": "user-a",
  "participants": [],
  "lastSeq": 1,
  "createdAt": "2026-10-19T06:00:00.000Z",
  "endedAt": null
}
```

### `GET /sessions/{id}` 세션 단건 조회 (추가)

현재 상태(프로젝션)를 돌려준다.

**Response 200**
```json
{
  "id": "0192a3b4-...",
  "status": "ACTIVE",
  "createdBy": "user-a",
  "participants": [
    { "userId": "user-a", "joinedAt": "...", "leftAt": null, "presence": "ONLINE" },
    { "userId": "user-b", "joinedAt": "...", "leftAt": null, "presence": "OFFLINE" }
  ],
  "lastSeq": 42,
  "messageCount": 30,
  "lastMessageAt": "2026-10-19T06:30:00.000Z",
  "createdAt": "2026-10-19T06:00:00.000Z",
  "endedAt": null
}
```

### `POST /sessions/{id}/join` 참여

- 세션이 `ACTIVE`여야 한다.
- 참여자는 최대 2명이다. 세 번째 사용자는 `409 SESSION_FULL`을 받는다.
- 이미 참여 중인 사용자가 다시 호출하면 새 이벤트를 만들지 않고 `200`으로 현재 참여 정보를 돌려준다(멱등).
- 나간 사용자의 재참여는 허용하지 않는다(`409 ALREADY_LEFT`). 7장 미결 사항 참고.

**Response 201 / 200**
```json
{ "event": { "...": "PARTICIPANT_JOINED 이벤트" } }
```

### `POST /sessions/{id}/leave` 나가기 (추가)

- 참여자만 호출할 수 있다.
- `ACTIVE` 세션에서 호출하면 세션이 `INTERRUPTED`로 바뀐다.
- 이미 나간 사용자가 다시 호출하면 `200`으로 기존 이벤트를 돌려준다(멱등).

**Response 201 / 200**
```json
{ "event": { "...": "PARTICIPANT_LEFT 이벤트" } }
```

### `POST /sessions/{id}/events` 이벤트/메시지 수집

현재는 `MESSAGE_CREATED`만 받는다. 참여, 나가기, 종료는 전용 엔드포인트를 사용한다.

**Request**
```json
{
  "clientEventId": "6f1c2d3e-...",
  "type": "MESSAGE_CREATED",
  "payload": { "content": "안녕하세요" },
  "clientSentAt": "2026-10-19T06:20:00.100Z"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `clientEventId` | ✅ | 클라이언트가 만든 UUID. 재전송할 때도 같은 값을 쓴다. |
| `type` | ✅ | `MESSAGE_CREATED` |
| `payload.content` | ✅ | 메시지 본문 (최대 길이는 미정) |
| `clientSentAt` | | 참고용 시각. 정렬에 쓰지 않는다. |

**처리 규칙**
- 세션이 `ACTIVE`이고 요청자가 참여 중(나가지 않음)이어야 한다.
- 같은 `clientEventId`가 이미 저장돼 있으면 새로 저장하지 않고 `200`으로 기존 이벤트를 돌려준다.
- 새로 저장하면 `201`로 응답하고, 커밋 후 socket room으로 broadcast한다.

**Response 201 / 200**
```json
{ "event": { "...": "MESSAGE_CREATED 이벤트" } }
```

### `GET /sessions/{id}/events?afterSeq=` 이벤트 조회 (추가)

재연결 후 놓친 이벤트를 받는 용도다.

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `afterSeq` | `0` | 이 값보다 큰 seq만 조회 |
| `limit` | `100` | 최대 500 |

**Response 200**
```json
{
  "events": [ { "...": "seq 오름차순" } ],
  "hasMore": false
}
```

### `POST /sessions/{id}/end` 종료

- `ACTIVE` 또는 `INTERRUPTED` 세션을 `COMPLETED`로 바꾼다.
- 이미 `COMPLETED`이면 `200`으로 기존 종료 이벤트를 돌려준다(멱등).
- 호출 권한: 참여자 또는 생성자 (확정 필요).

**Response 201 / 200**
```json
{ "event": { "...": "SESSION_ENDED 이벤트" } }
```

### `GET /sessions` 세션 목록

| 파라미터 | 설명 |
|---|---|
| `status` | `ACTIVE`, `INTERRUPTED`, `COMPLETED` (쉼표로 여러 개) |
| `participantId` | 해당 사용자가 참여한 세션 |
| `from`, `to` | 생성 시각 범위 (ISO-8601) |
| `cursor` | 이전 응답의 `nextCursor` |
| `limit` | 기본 20, 최대 100 |

정렬은 `createdAt DESC, id DESC`이며 커서 기반으로 페이지를 나눈다.

**Response 200**
```json
{
  "items": [ { "...": "GET /sessions/{id}와 같은 형식" } ],
  "nextCursor": "eyJjcmVhdGVkQXQiOi4uLn0="
}
```

### `GET /sessions/{id}/timeline` 특정 시점 상태 복원

`at`과 `seq` 중 하나를 지정한다. 둘 다 있으면 `seq`를 우선한다.

| 파라미터 | 설명 |
|---|---|
| `at` | 이 시각(서버 수신 시각 기준)까지의 이벤트로 복원 |
| `seq` | 이 seq까지의 이벤트로 복원 (디버깅, 테스트용) |

**복원 방식**
1. 기준 seq를 정한다. `at`이면 `receivedAt ≤ at`인 이벤트 중 가장 큰 seq를 쓴다.
2. 기준 seq 이하의 가장 최근 스냅샷을 불러온다. 없으면 빈 상태에서 시작한다.
3. 스냅샷 이후 이벤트를 seq 순으로 reducer에 적용한다.

같은 `at`으로 언제 조회해도 같은 결과가 나와야 한다.

**Response 200**
```json
{
  "sessionId": "0192a3b4-...",
  "at": "2026-10-19T06:25:00.000Z",
  "seq": 18,
  "state": {
    "status": "ACTIVE",
    "participants": [
      { "userId": "user-a", "joinedAt": "...", "leftAt": null, "presence": "ONLINE" },
      { "userId": "user-b", "joinedAt": "...", "leftAt": null, "presence": "OFFLINE" }
    ],
    "messageCount": 12,
    "lastMessage": { "seq": 17, "actorId": "user-a", "content": "...", "receivedAt": "..." }
  }
}
```

해당 시점의 메시지 목록이 필요하면 `GET /sessions/{id}/events?afterSeq=0`을 `seq` 기준까지 조회한다. 상태에 메시지 전체를 넣지 않는 이유는 스냅샷 크기를 작게 유지하기 위해서다.

## 5. socket.io

### 연결

- namespace: `/chat`
- handshake: `{ auth: { userId: "user-a" } }`. 없으면 연결을 거부한다.

### 클라이언트 → 서버

| 이벤트 | payload | 설명 |
|---|---|---|
| `session:subscribe` | `{ sessionId }` | room `session:{id}`에 들어간다. 참여 중인 사용자만 가능하다. |
| `session:unsubscribe` | `{ sessionId }` | room에서 나간다. |

socket으로는 메시지를 보내지 않는다. 메시지는 `POST /sessions/{id}/events`로 보낸다.

### 서버 → 클라이언트

| 이벤트 | payload | 설명 |
|---|---|---|
| `session:event` | 이벤트 공통 형식 | 커밋된 모든 이벤트 |
| `session:error` | `{ code, message }` | 구독 실패 등 |

### presence 처리

- `session:subscribe` 성공 시 해당 사용자의 연결이 그 세션에서 처음이면 `PRESENCE_ONLINE` 이벤트를 저장한다.
- 연결이 끊기면, 그 사용자의 해당 세션 연결이 모두 끊긴 경우에만 `PRESENCE_OFFLINE` 이벤트를 저장한다(여러 탭 고려).
- presence 이벤트는 Gateway가 `EventService`를 직접 호출해 저장한다. REST를 거치지 않는 유일한 쓰기 경로다.
- presence 이벤트도 seq를 받으므로 타임라인 복원에 포함된다.

### 클라이언트 동작 가이드

**메시지 전송**
1. `clientEventId`(UUID)를 만들어 `POST /events`를 호출한다.
2. 응답이 없거나 실패하면 같은 `clientEventId`로 재전송한다.
3. 자신의 메시지는 HTTP 응답과 `session:event`로 두 번 받는다. `eventId`로 하나를 걸러낸다.

**재연결**
1. socket이 다시 연결되면 `session:subscribe`를 먼저 보낸다.
2. 그다음 `GET /sessions/{id}/events?afterSeq={마지막으로 받은 seq}`로 놓친 이벤트를 받는다.
3. 두 경로로 겹쳐 받은 이벤트는 seq로 걸러낸다.

순서를 반대로 하면 조회와 구독 사이에 들어온 이벤트를 놓칠 수 있다.

## 6. 순서와 중복 처리 기준

| 상황 | 처리 |
|---|---|
| 같은 이벤트 재전송 | `clientEventId`가 같으면 기존 이벤트를 돌려주고 새로 저장하지 않는다. |
| 클라이언트 시계가 다름 | `clientSentAt`은 정렬에 쓰지 않는다. |
| 오프라인 중 작성한 메시지가 늦게 도착 | 도착 순서대로 seq를 받는다. 과거 순서에 끼워 넣지 않는다. |
| 동시에 두 요청 도착 | 세션 행 잠금으로 직렬화하고 순서대로 seq를 부여한다. |
| 클라이언트가 이벤트를 순서 없이 받음 | 클라이언트는 seq 순으로 정렬해서 표시하고, 빈 seq가 있으면 `GET /events`로 채운다. |

## 7. 미결 사항

- [ ] presence를 이벤트로 저장하는 방식 확정 (현재 초안은 이벤트로 저장)
- [ ] 나간 참여자의 재참여 허용 여부
- [ ] `end` 호출 권한 (참여자만 / 생성자 포함)
- [ ] 인증 방식 (현재 `X-User-Id` 헤더 임시 사용)
- [ ] 메시지 최대 길이, 지원 메시지 타입(텍스트 외)
- [ ] 스냅샷 생성 주기
- [ ] 다중 인스턴스 운영 시 presence 연결 수 관리 방식 (Redis 등)
