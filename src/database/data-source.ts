import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

// TypeORM CLI(마이그레이션) 전용 진입점. Nest 앱은 DatabaseModule을 사용한다.
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 환경 변수와 기본값을 사용한다.
}

export default new DataSource(buildDataSourceOptions(process.env));
