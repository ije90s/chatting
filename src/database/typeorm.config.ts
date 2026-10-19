import { DataSourceOptions } from 'typeorm';

type DbEnv = Record<string, string | undefined>;

export function buildDataSourceOptions(env: DbEnv): DataSourceOptions {
  return {
    type: 'mariadb',
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 3306),
    database: env.DB_NAME ?? 'chatting',
    username: env.DB_USER ?? 'chatting',
    password: env.DB_PASSWORD ?? 'chatting',
    charset: 'utf8mb4_unicode_ci',
    // DB와 애플리케이션 모두 UTC로 다룬다.
    timezone: 'Z',
    // BIGINT(seq, id)를 문자열이 아닌 number로 받는다. 안전 범위를 넘으면 문자열로 온다.
    supportBigNumbers: true,
    bigNumberStrings: false,
    // 각 도메인 모듈의 entities/*.entity.ts를 찾는다(마이그레이션 CLI용).
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    // 스키마는 마이그레이션으로만 바꾼다.
    synchronize: false,
  };
}
