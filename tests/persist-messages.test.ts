import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { PostgreSqlContainer, StartedPostgreSqlContainer, GenericContainer, StartedTestContainer } from 'testcontainers';
import { Client } from 'pg';
import { createApp, closeApp } from '../src/app';

describe('Persist Messages (Direct Write)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let pgClient: Client;
  let app: any;
  let server: any;
  let port: number;
  let validToken: string;
  let userId: number;

  beforeAll(async () => {
    // 1. Spin up DB
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    const dbUrl = pgContainer.getConnectionUri();
    process.env.DATABASE_URL = dbUrl;
    process.env.JWT_SECRET = 'test-secret';

    // App now requires Redis for pub/sub fan-out.
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    // 2. Initialize App
    const instance = await createApp();
    app = instance.app;
    server = instance.server;

    // 3. Connect raw Postgres client for test verification
    pgClient = new Client({ connectionString: dbUrl });
    await pgClient.connect();

    // 4. Get Port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 80 : address.port;
        resolve();
      });
    });

    // 5. Seed a user and get token
    const res = await request(app)
      .post('/signup')
      .send({ username: 'chatter', password: 'password123' });
    validToken = res.body.token;

    // Fetch the user ID to verify relations later
    const userResult = await pgClient.query("SELECT id FROM users WHERE username = 'chatter'");
    userId = userResult.rows[0].id;
  }, 30000);

  afterAll(async () => {
    await pgClient.end();
    await closeApp();
    await server.close();
    await pgContainer.stop();
    await redisContainer.stop();
  });

  it('should persist a chat message directly to the database', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}?token=${validToken}`);
      
      ws.on('open', () => {
        // 1. Join room
        ws.send(JSON.stringify({ type: 'join', roomId: 'db-room' }));
        
        // 2. Send message
        ws.send(JSON.stringify({ type: 'chat', roomId: 'db-room', text: 'This should hit Postgres' }));

        // 3. Wait a moment for the sync write to finish, then assert DB state
        setTimeout(async () => {
          try {
            // Query the messages table (Claude needs to create this)
            const result = await pgClient.query(
              "SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1",
              ['db-room']
            );

            const row = result.rows[0];
            
            expect(row).toBeDefined();
            expect(row.content).toBe('This should hit Postgres');
            // The sender_id should link back to the user who sent it
            expect(row.sender_id).toBe(userId);

            ws.close();
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 100); // 100ms delay to allow server to insert
      });

      ws.on('error', reject);
    });
  });
});
