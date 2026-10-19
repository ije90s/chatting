import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './typeorm.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions({
          DB_HOST: config.get<string>('DB_HOST'),
          DB_PORT: config.get<string>('DB_PORT'),
          DB_NAME: config.get<string>('DB_NAME'),
          DB_USER: config.get<string>('DB_USER'),
          DB_PASSWORD: config.get<string>('DB_PASSWORD'),
        }),
        // 엔티티는 각 도메인 모듈의 TypeOrmModule.forFeature()로 등록한다.
        entities: [],
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
