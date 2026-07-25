import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('health query returns ok', () => {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ health }' })
      .expect(200)
      .expect((res) => { expect(res.body.data.health).toBe('ok'); });
  });
});
