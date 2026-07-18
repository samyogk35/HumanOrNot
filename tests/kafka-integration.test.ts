import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { PostgreSqlContainer, GenericContainer, KafkaContainer } from 'testcontainers';
import { Client } from 'pg';
import { createApp, closeApp } from '../src/app';
import { startKafkaConsumer, stopKafkaConsumer } from '../src/kafka-consumer'; // Claude needs to implement

describe('Kafka Write Path Integration', () => {
  let pgContainer: any;
  let redisContainer: any;
  let kafkaContainer: any;
  
  let pgClient: Client;
  let app: any;
  let server: any;
  let port: number;
  let validToken: string;
  let userId: number;

  beforeAll(async () => {
    // 1. Boot Infra (DB, Redis, Kafka)
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    // Pin the image + give Kafka a generous startup budget; the default unpinned
    // image intermittently exits before it's ready on shared CI runners.
    kafkaContainer = await new KafkaContainer('confluentinc/cp-kafka:7.5.0')
      .withStartupTimeout(120_000)
      .start();
    
    const dbUrl = pgContainer.getConnectionUri();
    process.env.DATABASE_URL = dbUrl;
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    process.env.KAFKA_BROKERS = `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`;
    process.env.JWT_SECRET = 'kafka-secret';

    // 2. Initialize App (Producer)
    const instance = await createApp();
    app = instance.app;
    server = instance.server;
    
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    // 3. Initialize Background Worker (Consumer)
    await startKafkaConsumer();

    // 4. DB Client for verification
    pgClient = new Client({ connectionString: dbUrl });
    await pgClient.connect();

    // 5. Seed user
    const res = await request(app).post('/signup').send({ username: 'kafka_user', password: 'pw' });
    validToken = res.body.token;
    
    const userResult = await pgClient.query("SELECT id FROM users WHERE username = 'kafka_user'");
    userId = userResult.rows[0].id;
  }, 90000); // Kafka container takes a bit longer to boot

  afterAll(async () => {
    // Guard every step: if beforeAll bailed partway (e.g. Kafka container died),
    // the unset handles must not throw and mask the real setup failure.
    await stopKafkaConsumer().catch(() => {});
    await closeApp().catch(() => {});
    await pgClient?.end().catch(() => {});

    await kafkaContainer?.stop().catch(() => {});
    await redisContainer?.stop().catch(() => {});
    await pgContainer?.stop().catch(() => {});
  });

  it('should buffer messages through Kafka before batch writing to Postgres', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}?token=${validToken}`);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join', roomId: 'kafka-room' }));
        
        // Send a burst of 5 messages
        for (let i = 1; i <= 5; i++) {
          ws.send(JSON.stringify({ type: 'chat', roomId: 'kafka-room', text: `Message ${i}` }));
        }

        // Wait 2 seconds for Kafka produce -> consume -> batch flush -> DB insert
        setTimeout(async () => {
          try {
            const result = await pgClient.query(
              "SELECT content FROM messages WHERE room_id = 'kafka-room' ORDER BY content ASC"
            );

            expect(result.rows.length).toBe(5);
            expect(result.rows[0].content).toBe('Message 1');
            expect(result.rows[4].content).toBe('Message 5');

            ws.close();
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 2000);
      });

      ws.on('error', reject);
    });
  });
});
