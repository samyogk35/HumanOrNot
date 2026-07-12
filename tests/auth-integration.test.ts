import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { PostgreSqlContainer, StartedPostgreSqlContainer, GenericContainer, StartedTestContainer } from 'testcontainers';
import { createApp, closeApp } from '../src/app'; // Claude to implement Express app factory

describe('Auth + DB Integration Tests', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let app: any; // Express app
  let server: any; // HTTP Server
  let port: number;
  let validToken: string;

  beforeAll(async () => {
    // 1. Spin up ephemeral Postgres database for tests
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.JWT_SECRET = 'test-secret';

    // App now requires Redis for pub/sub fan-out.
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    // 2. Initialize App & DB
    const instance = await createApp();
    app = instance.app;
    server = instance.server;

    // 3. Listen on random port for WS tests
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 80 : address.port;
        resolve();
      });
    });
  }, 30000); // 30s timeout for downloading postgres image

  afterAll(async () => {
    await closeApp();
    await server.close();
    await pgContainer.stop();
    await redisContainer.stop();
  });

  describe('HTTP REST endpoints', () => {
    it('POST /signup -> successfully creates user', async () => {
      const res = await request(app)
        .post('/signup')
        .send({ username: 'testuser', password: 'password123' });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      validToken = res.body.token; // Save for WS tests
    });

    it('POST /signup -> rejects duplicate username', async () => {
      const res = await request(app)
        .post('/signup')
        .send({ username: 'testuser', password: 'differentpassword' });
      
      expect(res.status).toBe(409); // Conflict
    });

    it('POST /login -> returns token for valid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'password123' });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    it('POST /login -> rejects bad password', async () => {
      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'wrongpassword' });
      
      expect(res.status).toBe(401);
    });
  });

  describe('WebSocket Authentication (Upgrade)', () => {
    it('WS Upgrade -> connects with valid token', async () => {
      return new Promise<void>((resolve, reject) => {
        // Pass token via query param or headers. Query param is easier for raw WS.
        const ws = new WebSocket(`ws://localhost:${port}?token=${validToken}`);
        
        ws.on('open', () => {
          ws.close();
          resolve();
        });
        
        ws.on('unexpected-response', (req, res) => {
          reject(new Error(`Upgrade rejected with ${res.statusCode}`));
        });
      });
    });

    it('WS Upgrade -> rejects missing token', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401);
          resolve();
        });
        
        ws.on('open', () => reject(new Error('Should not have connected')));
      });
    });

    it('WS Upgrade -> rejects invalid token', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}?token=fake.token.here`);
        
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401);
          resolve();
        });
        
        ws.on('open', () => reject(new Error('Should not have connected')));
      });
    });
  });
});
