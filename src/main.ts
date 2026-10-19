import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Chatting API')
    .setDescription('1:1 실시간 채팅 서비스 API')
    .setVersion('0.0.1')
    .addApiKey({ type: 'apiKey', name: 'X-User-Id', in: 'header' }, 'user-id')
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
