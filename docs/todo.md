# 구현 투두

위에서부터 순서대로 진행한다. 각 단계는 도메인별 모듈 - 컨트롤러 - 서비스 - 레포지토리, DTO, 엔티티 구성을 따른다(CLAUDE.md 코딩 규칙).

## 1. common (공통)

- [x] 요청 검증: `class-validator`, `class-transformer` 추가, 전역 `ValidationPipe`
- [x] 응답 형식: 성공 `{ success: true, data }` 인터셉터
- [x] 에러 형식: 에러 코드 정의, `{ success: false, code, message }` 예외 필터
- [x] 사용자 식별: `X-User-Id` 헤더 검사(없으면 `401`), 사용자 ID 데코레이터

## 2. session (엔티티)

- [x] `sessions`, `participants` 엔티티 + 마이그레이션

## 3. event (이벤트 저장)

- [x] `messages` 엔티티 + 마이그레이션
- [x] reducer: `reduce(state, event) → state` 순수 함수, 상태 전이 검증 — 유닛 테스트
- [x] `EventService` 단일 쓰기 경로: 세션 잠금 → 중복 확인 → 상태 검증 → seq 부여 → 이벤트·프로젝션 저장 (한 트랜잭션) — 유닛 테스트 (중복 처리, seq 부여)

## 4. projection (스냅샷, 복원)

- [x] `snapshots` 엔티티 + 마이그레이션
- [x] `shouldSnapshot(event)` 기록 조건 + `EventService` 트랜잭션에 스냅샷 기록 연결 — 유닛 테스트
- [x] 타임라인 복원: 기준 seq 결정 → 스냅샷 로드 → 이후 이벤트 적용 — 유닛 테스트

## 5. session (API)

- [x] `POST /sessions`: 세션 생성 + 생성자 자동 참여
- [x] `POST /sessions/{id}/join`
- [x] `POST /sessions/{id}/events`: 메시지, 나가기
- [x] `POST /sessions/{id}/end`
- [x] `GET /sessions`: 상태/참여자/기간 필터, 커서 페이지네이션
- [x] `GET /sessions/{id}/timeline?at=`

## 6. realtime (socket.io)

- [x] `@nestjs/websockets`, `@nestjs/platform-socket.io` 추가, `ChatGateway` (`/chat`, handshake `userId`)
- [x] `session:subscribe` / `session:unsubscribe`
- [ ] presence: 첫 연결 시 `PRESENCE_ONLINE`, 연결이 모두 끊기면 `PRESENCE_OFFLINE`
- [ ] 커밋 후 `session:event` broadcast (중복 요청은 broadcast하지 않음)

## 7. 마무리

- [ ] e2e 테스트: 생성 → 참여 → 메시지(재전송 중복 포함) → 나가기/종료 → 타임라인 복원
- [ ] 구현과 문서(api.md, db.md, README) 일치 확인
