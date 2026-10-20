# API 설계 

1:1 실시간 채팅 서비스의 REST API 명세이다.

## 1. 설계 원칙

| 원칙 | 내용 |
|---|---|
| 쓰기 경로는 REST | 메시지, join, leave, end 등 모든 쓰기는 REST로 들어온다. 예외는 presence뿐이다. |
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

- 앞뒤 공백을 제거한 값을 사용자 ID로 쓴다. 없거나 비어 있으면 `401 UNAUTHORIZED`다.
- 최대 64자(`participants.user_id` 길이)다. 넘으면 `400 VALIDATION_ERROR`다.

### 시간 형식

- 모든 시각은 ISO-8601 UTC, 밀리초까지 표기한다. 예: `2026-10-19T06:20:00.123Z`
- 응답의 `receivedAt`은 서버 수신 시각이다. `clientSentAt`은 클라이언트가 보낸 값을 그대로 돌려준다.

### 응답 형식

모든 REST 응답은 아래 두 형식 중 하나다. 성공 여부는 `success`로 구분하고, 결과의 종류(신규/중복 등)는 HTTP 상태 코드로 구분한다.

**성공**
```json
{
  "success": true,
  "data": { }
}
```

**실패**
```json
{
  "success": false,
  "code": "INVALID_SESSION_STATUS",
  "message": "현재 세션 상태에서 허용되지 않는 요청입니다."
}
```

이후 각 API의 Response 예시는 `data`에 들어가는 값만 적는다.

| HTTP | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 요청 형식 오류 |
| 401 | `UNAUTHORIZED` | 사용자 식별 정보 없음 |
| 403 | `NOT_PARTICIPANT` | 세션 참여자가 아닌 사용자의 요청 |
| 404 | `NOT_FOUND` | 없는 경로 |
| 404 | `SESSION_NOT_FOUND` | 세션 없음 (UUID 형식이 아닌 세션 ID 포함) |
| 409 | `SESSION_FULL` | 참여자가 이미 2명 |
| 409 | `INVALID_SESSION_STATUS` | 현재 세션 상태에서 허용되지 않는 요청 (예: `END` 세션에 메시지) |
| 409 | `ALREADY_LEFT` | 이미 나간 참여자가 다시 요청 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류. 내부 정보는 응답에 넣지 않는다. |

## 3. 세션 상태와 이벤트

### 세션 상태

| 상태 | 의미 | 진입 조건 |
|---|---|---|
| `JOIN` (진행중) | 대화 진행 가능 | 세션 생성 (생성자 자동 참여) |
| `LEAVE` (중단) | 정상 종료 없이 참여자가 나감 | `JOIN`에서 leave |
| `END` (완료) | 정상 종료 | `JOIN` 또는 `LEAVE`에서 end |

```
JOIN ──(leave)──▶ LEAVE
  │                  │
  └──(end)──▶ END ◀──(end)
```

- 세션 상태는 생성, leave, end로만 바뀐다. 두 번째 참여자의 join은 상태를 바꾸지 않는다.
- online/offline은 참여자별 presence로 따로 관리하며, 세션 상태에 영향을 주지 않는다.
- 메시지와 join은 `JOIN`에서만 허용한다.

### 이벤트 타입

| 타입 | 발생 경로 | 세션 상태 변화 |
|---|---|---|
| `SESSION_CREATED` | `POST /sessions` | → `JOIN` |
| `PARTICIPANT_JOINED` | `POST /sessions` (생성자), `POST /sessions/{id}/join` | 없음 |
| `PARTICIPANT_LEFT` | `POST /sessions/{id}/events` | `JOIN` → `LEAVE` |
| `MESSAGE_CREATED` | `POST /sessions/{id}/events` | 없음 |
| `PRESENCE_ONLINE` | socket 구독 시작 | 없음 |
| `PRESENCE_OFFLINE` | socket 연결 끊김 | 없음 |
| `SESSION_ENDED` | `POST /sessions/{id}/end` | → `END` |

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

### 세션 형식

`POST /sessions`, `GET /sessions`에서 같은 형식을 사용한다.

```json
{
  "id": "0192a3b4-...",
  "title": "상담 문의",
  "status": "JOIN",
  "createdBy": "user-a",
  "participants": [
    { "userId": "user-a", "joinedAt": "...", "leftAt": null, "presence": "ONLINE" },
    { "userId": "user-b", "joinedAt": "...", "leftAt": null, "presence": "OFFLINE" }
  ],
  "lastSeq": 42,
  "createdAt": "2026-10-19T06:00:00.000Z",
  "endedAt": null
}
```

## 4. REST API

| API | 설명 |
|---|---|
| `POST /sessions` | 세션 생성 |
| `POST /sessions/{id}/join` | 참여 |
| `POST /sessions/{id}/events` | 이벤트/메시지 수집 |
| `POST /sessions/{id}/end` | 종료 |
| `GET /sessions` | 세션 목록 조회 (기간/상태/참여자 필터) |
| `GET /sessions/{id}/timeline?at=` | 특정 시점 상태 복원 |

### `POST /sessions` 세션 생성

요청한 사용자가 생성자로 기록되고, 같은 트랜잭션에서 자동으로 참여한다. `SESSION_CREATED`(seq 1)와 생성자의 `PARTICIPANT_JOINED`(seq 2)가 함께 저장된다.

**Request**
```json
{ "title": "상담 문의" }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `title` | ✅ | 세션 제목. 앞뒤 공백을 제거한 뒤 1~100자(공백만 있으면 거절). 이모지는 쓸 수 없다(`400 VALIDATION_ERROR`). |

**Response 201** (`data`)
```json
{
  "id": "0192a3b4-...",
  "title": "상담 문의",
  "status": "JOIN",
  "createdBy": "user-a",
  "participants": [
    { "userId": "user-a", "joinedAt": "...", "leftAt": null, "presence": "OFFLINE" }
  ],
  "lastSeq": 2,
  "createdAt": "2026-10-19T06:00:00.000Z",
  "endedAt": null
}
```

### `POST /sessions/{id}/join` 참여

- 세션이 `JOIN`이어야 한다.
- 참여자는 최대 2명이다(생성자 포함). 세 번째 사용자는 `409 SESSION_FULL`을 받는다.
- 이미 참여 중인 사용자가 다시 호출하면 새 이벤트를 만들지 않고 `200`으로 기존 `PARTICIPANT_JOINED` 이벤트를 돌려준다(멱등).
- 나간 사용자의 재참여는 허용하지 않는다(`409 ALREADY_LEFT`).

**Response 201 / 200** (`data`)
```json
{ "...": "PARTICIPANT_JOINED 이벤트 (이벤트 공통 형식)" }
```

### `POST /sessions/{id}/events` 이벤트/메시지 수집

메시지와 나가기를 받는다. 참여와 종료는 전용 엔드포인트를 사용한다.

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
| `clientEventId` | ✅ | 클라이언트가 만든 UUID. 재전송할 때도 같은 값을 쓴다. 아래 "`clientEventId` 규칙" 참고. |
| `type` | ✅ | `MESSAGE_CREATED` 또는 `PARTICIPANT_LEFT` |
| `payload` | | `MESSAGE_CREATED`: `{ "content": "..." }` (필수. 공백만 있으면 안 되고, 최대 5000자(코드 포인트 기준, 이모지 1개 = 1자). 앞뒤 공백을 포함해 보낸 그대로 저장한다) / `PARTICIPANT_LEFT`: `{}` 또는 생략. 정의되지 않은 필드가 있으면 `400 VALIDATION_ERROR` |
| `clientSentAt` | | 참고용 시각(ISO-8601). 정렬에 쓰지 않는다. 응답에서는 UTC로 바꿔 돌려준다. |

**`clientEventId` 규칙**
- 클라이언트가 만든다. 서버는 발급하지 않는다.
- 형식은 UUID다. 랜덤 값인 v4를 권장한다.
- 보낼 이벤트 하나당 한 번 만든다. HTTP 요청마다 새로 만들지 않는다. 재전송할 때는 같은 값을 쓴다.
- 필수다. 없거나 UUID 형식이 아니면 `400 VALIDATION_ERROR`로 거절한다. 서버가 대신 만들어 주지 않는다.
- 서버가 발급하지 않는 이유: 막아야 할 상황은 "서버는 저장했지만 응답이 유실된 경우"다. 키가 서버에서 처음 생기면 재전송 요청을 첫 요청과 연결할 수 없다. 사전 발급 API를 두면 메시지마다 요청이 하나 더 들고, 발급한 키를 저장할 테이블도 필요하다.

**처리 규칙**
- 중복 확인을 상태 검증보다 먼저 한다. 이미 저장된 `clientEventId`면 세션이 그 뒤 `END`가 됐더라도 `200`으로 기존 이벤트를 돌려준다. 저장된 적 없는 키만 상태를 검증한다(실패 시 `409`).
- 요청자가 참여 중(나가지 않음)이어야 한다.
- `MESSAGE_CREATED`: 세션이 `JOIN`이어야 한다.
- `PARTICIPANT_LEFT`: 세션이 `JOIN`이면 `LEAVE`로 바뀐다. 이미 나간 사용자가 다시 보내면 `200`으로 기존 `PARTICIPANT_LEFT` 이벤트를 돌려준다(멱등).
- 같은 `clientEventId`가 이미 저장돼 있으면 새로 저장하지 않고 `200`으로 기존 이벤트를 돌려준다. 중복 요청은 다시 broadcast하지 않는다.
- 새로 저장하면 `201`로 응답하고, 커밋 후 socket room으로 broadcast한다.

**Response 201 / 200** (`data`)
```json
{ "...": "저장된 이벤트 (이벤트 공통 형식)" }
```

### `POST /sessions/{id}/end` 종료

- `JOIN` 또는 `LEAVE` 세션을 `END`로 바꾼다.
- 이미 `END`이면 `200`으로 기존 `SESSION_ENDED` 이벤트를 돌려준다(멱등).
- 참여 중인 사용자(나가지 않음)만 호출할 수 있다. 생성자도 생성 시 자동 참여하므로 별도 권한을 두지 않는다. 그 외에는 `403 NOT_PARTICIPANT`.

**Response 201 / 200** (`data`)
```json
{ "...": "SESSION_ENDED 이벤트 (이벤트 공통 형식)" }
```

### `GET /sessions` 세션 목록

`X-User-Id`가 필요하다(없으면 `401`). 조회 범위는 전체 세션이며, 참여자로 좁히려면 `participantId`를 쓴다.

| 파라미터 | 설명 |
|---|---|
| `status` | `JOIN`, `LEAVE`, `END` (쉼표로 여러 개) |
| `participantId` | 해당 사용자가 참여한 세션. 나간 세션도 포함한다. |
| `from`, `to` | 생성 시각 범위 (ISO-8601). `from ≤ createdAt < to` |
| `cursor` | 이전 응답의 `nextCursor` |
| `limit` | 기본 20, 1~100 |

정렬은 `createdAt DESC, id DESC`이며 커서 기반으로 페이지를 나눈다.

- 커서는 그 페이지 마지막 항목의 `{ createdAt, id }`를 base64url JSON으로 담은 값이다. 클라이언트는 내용을 해석하지 않고 그대로 돌려보낸다.
- 다음 페이지가 없으면 `nextCursor`는 `null`이다.
- 커서를 쓸 때는 첫 요청과 같은 필터를 함께 보낸다.
- 범위를 벗어난 `limit`, 없는 `status`, ISO-8601이 아닌 시각, 잘못된 커서, 정의되지 않은 파라미터는 `400 VALIDATION_ERROR`다.

**Response 200** (`data`)
```json
{
  "items": [ { "...": "세션 형식" } ],
  "nextCursor": "eyJjcmVhdGVkQXQiOi4uLn0"
}
```

### `GET /sessions/{id}/timeline?at=` 특정 시점 상태 복원

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `at` | ✅ | 이 시각(서버 수신 시각 기준)까지의 이벤트로 복원 (ISO-8601) |

- `X-User-Id`가 필요하다(없으면 `401`). 조회 범위는 `GET /sessions`와 같이 전체 세션이다.
- `at`이 없거나 ISO-8601이 아니면 `400 VALIDATION_ERROR`다. 응답의 `at`은 UTC로 바꿔 돌려준다.
- 마지막 이벤트 이후 시각이면 현재 상태를 돌려준다.

**복원 방식**
1. 기준 seq를 정한다. `receivedAt ≤ at`인 이벤트 중 가장 큰 seq를 쓴다. 해당 이벤트가 없으면(세션 생성 이전 시각) `404 SESSION_NOT_FOUND`를 돌려준다.
2. 기준 seq 이하의 가장 최근 스냅샷을 불러온다. 없으면 빈 상태에서 시작한다.
3. 스냅샷 이후 이벤트를 seq 순으로 reducer에 적용한다.

같은 `at`으로 언제 조회해도 같은 결과가 나와야 한다.

**Response 200** (`data`)
```json
{
  "sessionId": "0192a3b4-...",
  "at": "2026-10-19T06:25:00.000Z",
  "seq": 18,
  "state": {
    "status": "JOIN",
    "participants": [
      { "userId": "user-a", "joinedAt": "...", "leftAt": null, "presence": "ONLINE" },
      { "userId": "user-b", "joinedAt": "...", "leftAt": null, "presence": "OFFLINE" }
    ],
    "messageCount": 12,
    "lastMessage": { "seq": 17, "actorId": "user-a", "content": "...", "receivedAt": "..." }
  }
}
```

상태에 메시지 전체를 넣지 않는 이유는 스냅샷 크기를 작게 유지하기 위해서다.

## 5. 실시간 (socket.io)

수신 전용 채널이다. 메시지 전송은 `POST /sessions/{id}/events`로 한다.

- namespace `/chat`, handshake `{ auth: { userId } }`. 없으면 연결을 거부한다.
- `userId`는 REST의 `X-User-Id`와 같은 규칙으로 검사한다(앞뒤 공백 제거, 비어 있으면 `UNAUTHORIZED`, 64자 초과면 `VALIDATION_ERROR`).
- 거부하면 클라이언트는 `connect_error`를 받는다. 에러의 `data`는 REST 실패 응답과 같은 `{ success: false, code, message }`다.

| 방향 | 이벤트 | payload | 설명 |
|---|---|---|---|
| 클라이언트 → 서버 | `session:subscribe` | `{ sessionId }` | room `session:{id}`에 들어간다. 참여 기록이 있는 사용자만 가능하다(나간 참여자 포함). |
| 클라이언트 → 서버 | `session:unsubscribe` | `{ sessionId }` | room에서 나간다. 구독하지 않은 세션이어도 성공이다. |
| 서버 → 클라이언트 | `session:event` | 이벤트 공통 형식 | 커밋된 모든 이벤트 |
| 서버 → 클라이언트 | `session:error` | `{ success: false, code, message }` | 구독 실패 등 |

**`session:event` 전달**
- REST(생성, 참여, 메시지, 나가기, 종료)와 presence로 새로 저장된 이벤트를 트랜잭션 커밋 후 `session:{id}` room에 전달한다. 형식은 REST 응답의 이벤트와 같다.
- 중복 요청(같은 `clientEventId`, 다시 참여, 다시 나가기, 다시 종료)과 실패한 요청은 전달하지 않는다.
- 이미 커밋된 뒤이므로 전달에 실패해도 요청 결과는 바뀌지 않고 서버 로그만 남는다.
- 서로 다른 요청의 전달 순서가 seq와 어긋날 수 있다. 클라이언트는 seq로 정렬하고, 빠진 seq는 타임라인이나 세션의 `lastSeq`로 확인한다.

**구독 결과**
- `session:subscribe`, `session:unsubscribe`는 ack로 결과를 돌려준다. 성공은 `{ success: true, data: { sessionId } }`, 실패는 `{ success: false, code, message }`다.
- 실패하면 같은 내용을 `session:error`로도 보낸다.
- 실패 코드: `VALIDATION_ERROR`(`sessionId`가 비어 있지 않은 문자열이 아님), `SESSION_NOT_FOUND`, `NOT_PARTICIPANT`, `INTERNAL_ERROR`.

**presence**
- `session:subscribe`가 성공하고 그 사용자의 해당 세션 구독이 처음이면 `PRESENCE_ONLINE`을 저장한다.
- 그 사용자의 해당 세션 구독이 모두 끝나면 `PRESENCE_OFFLINE`을 저장한다(여러 탭 고려). `session:unsubscribe`와 연결 끊김 모두 구독이 끝난 것으로 본다.
- Gateway가 `EventService`를 직접 호출해 저장한다. seq를 받으므로 타임라인 복원에 포함된다.
- 같은 사용자·세션의 presence 저장은 발생 순서대로 하나씩 처리한다(ONLINE과 OFFLINE의 순서가 뒤집히지 않게).
- presence 저장이 실패해도 구독 결과는 바뀌지 않고 서버 로그만 남는다.
- 구독 상태는 서버 메모리에서 센다(단일 인스턴스 기준). 재시작하면 사라지므로, 서버는 연결을 받기 전에 `ONLINE`으로 남은 참여자마다 `PRESENCE_OFFLINE`을 저장한다.

**단일 인스턴스 제약 (수평 확장 시)**

현재 실시간 계층은 서버 한 대를 전제로 한다. 여러 대로 늘리면 아래 세 가지를 바꿔야 한다. seq 부여, 중복 방지, 상태 전이는 DB 행 잠금과 UNIQUE 제약으로 처리하므로 영향이 없다.

| 대상 | 현재 | 여러 대일 때 문제 | 바꿀 방향 |
|---|---|---|---|
| broadcast | socket.io room이 프로세스 메모리에 있다 | 다른 서버에 연결된 구독자는 이벤트를 받지 못한다 | socket.io adapter로 서버 간 emit을 중계한다. MariaDB용 adapter는 없으므로 Redis adapter를 쓴다. |
| presence 구독 수 | 사용자·세션별 구독 소켓 수를 프로세스 메모리에서 센다 | 다른 서버에 남은 탭을 몰라 OFFLINE을 잘못 저장한다 | Redis 공유 카운터, 또는 adapter의 `fetchSockets()`로 전체 서버의 구독 여부를 확인한다. |
| 시작 시 presence 정리 | 시작할 때 `ONLINE`인 참여자를 모두 `OFFLINE`으로 기록한다 | 한 대만 재시작해도 다른 서버의 정상 연결까지 `OFFLINE`이 된다 | 연결마다 서버 ID를 기록해 자기 서버의 연결만 정리하거나, TTL·하트비트로 응답이 끊긴 연결만 정리한다. |

- Redis 하나를 추가하면 broadcast와 presence 구독 수를 함께 해결할 수 있다.
- broadcast는 `Broadcaster`를 통해서만 내보내므로, adapter를 붙여도 이벤트 저장 코드는 바뀌지 않는다.
- socket.io의 HTTP long-polling을 쓰려면 로드 밸런서에 sticky session이 필요하다. WebSocket 전송만 쓰면 필요 없다.

## 6. 순서 처리 기준

- 정식 순서는 서버가 세션별로 부여하는 `seq`다. 세션 행을 잠근 뒤 `last_seq + 1`을 부여하므로 동시 요청도 순서대로 직렬화된다.
- `clientSentAt`은 정렬과 복원에 쓰지 않는다(클라이언트 시계는 기기마다 다르다).
- 늦게 도착한 이벤트(오프라인 중 작성 등)는 도착 순서대로 seq를 받는다. 과거 순서에 끼워 넣지 않는다.
- 클라이언트는 받은 이벤트를 seq 순으로 정렬해 표시한다.
