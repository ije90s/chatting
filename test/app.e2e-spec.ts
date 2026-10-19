import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ success: true, data: 'Hello World!' });
  });

  it('없는 경로는 공통 에러 형식으로 응답한다', () => {
    return request(app.getHttpServer()).get('/not-found').expect(404).expect({
      success: false,
      code: 'NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
