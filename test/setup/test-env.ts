// 통합/e2e 테스트는 개발 DB가 아닌 별도 테스트 DB를 쓴다.
// 환경 변수가 .env보다 우선하므로 ConfigModule과 TypeORM CLI 설정 모두 이 값을 따른다.
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 환경 변수와 기본값을 사용한다.
}

process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'chatting_test';
