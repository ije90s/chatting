import { createConnection } from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/typeorm.config';
import './test-env';

// 테스트 DB를 만들고(없으면) 마이그레이션을 적용한다. 앱 계정에는 DB 생성 권한이 없어 root로 만든다.
export default async function globalSetup(): Promise<void> {
  const database = process.env.DB_NAME!;
  const root = await createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: 'root',
    password: process.env.DB_ROOT_PASSWORD ?? 'root',
  });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await root.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@'%'`, [
    process.env.DB_USER ?? 'chatting',
  ]);
  await root.end();

  const dataSource = new DataSource(buildDataSourceOptions(process.env));
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
