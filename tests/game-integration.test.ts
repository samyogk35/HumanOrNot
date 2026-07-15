import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
  GenericContainer,
  StartedTestContainer,
} from 'testcontainers';
import { createApp, closeApp } from '../src/app';

// Phase 10: the whole game loop end-to-end on a single instance with the mock
// bot — join -> start -> bot chatters on a cadence -> voting -> reveal. Durations
// are shrunk via env so the timed phases complete in well under the test timeout.
describe('Game Integration: full loop with mock bot (single instance)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let app: any, server: any, port: number;
  let tokenA: string, tokenB: string;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();

    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    process.env.JWT_SECRET = 'integration-secret';
    delete process.env.KAFKA_BROKERS; // direct DB writes; no Kafka in this test
    // Fast phases + a bot cadence short enough to fire inside the chat window.
    process.env.CHAT_DURATION_MS = '500';
    process.env.VOTE_DURATION_MS = '500';
    process.env.BOT_CADENCE_MS = '150';

    const instance = await createApp();
    app = instance.app;
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    tokenA = (await request(app).post('/signup').send({ username: 'alice', password: 'pw' })).body.token;
    tokenB = (await request(app).post('/signup').send({ username: 'bob', password: 'pw' })).body.token;
  }, 60000);

  afterAll(async () => {
    await closeApp();
    await server.close();
    await pgContainer.stop();
    await redisContainer.stop();
  });

  it('runs join -> start -> bot chat -> voting -> reveal', async () => {
    const roomId = 'game-room';
    const clientA = new WebSocket(`ws://localhost:${port}?token=${tokenA}`);
    const clientB = new WebSocket(`ws://localhost:${port}?token=${tokenB}`);

    const events: any[] = [];
    let roster: Array<{ id: string; username: string }> = [];

    return new Promise<void>((resolve, reject) => {
      const fail = setTimeout(() => reject(new Error('timed out before reveal')), 12000);

      let openCount = 0;
      const onOpen = () => {
        if (++openCount < 2) return;
        clientA.send(JSON.stringify({ type: 'join', roomId }));
        clientB.send(JSON.stringify({ type: 'join', roomId }));
        // Give both subscriptions time to land, then start the game.
        setTimeout(() => clientA.send(JSON.stringify({ type: 'start', roomId })), 150);
      };
      clientA.on('open', onOpen);
      clientB.on('open', onOpen);

      const voted = { A: false, B: false };
      const handle = (raw: WebSocket.RawData, who: 'A' | 'B', sock: WebSocket) => {
        const msg = JSON.parse(raw.toString());
        if (who === 'A') events.push(msg);
        if (msg.type === 'users') roster = msg.users;
        if (msg.type === 'state' && msg.state === 'voting' && !voted[who]) {
          voted[who] = true;
          // Vote for the first roster entry (a human; bot is appended last).
          sock.send(JSON.stringify({ type: 'vote', roomId, targetId: roster[0].id }));
        }
        if (who === 'A' && msg.type === 'reveal') {
          clearTimeout(fail);
          try {
            // Roster carried the injected bot: 2 humans + 1 bot.
            const usersEvents = events.filter((e) => e.type === 'users');
            expect(usersEvents.at(-1).users).toHaveLength(3);

            // Chatting phase was announced.
            expect(events.some((e) => e.type === 'state' && e.state === 'chatting')).toBe(true);

            // The mock bot spoke on its cadence (bot ids are negative -> "-1").
            const botChats = events.filter(
              (e) => e.type === 'chat' && String(e.senderId).startsWith('-')
            );
            expect(botChats.length).toBeGreaterThanOrEqual(1);
            expect(typeof botChats[0].id).toBe('string');
            expect(botChats[0].text.length).toBeGreaterThan(0);

            // Reveal exposes the true bot (string id) and the vote tally.
            expect(typeof msg.trueBotId).toBe('string');
            expect(msg.trueBotId.startsWith('-')).toBe(true);
            expect(msg.tally[roster[0].id]).toBe(2); // both voted the same human
            clientA.close();
            clientB.close();
            resolve();
          } catch (e) {
            clientA.close();
            clientB.close();
            reject(e);
          }
        }
      };

      clientA.on('message', (d) => handle(d, 'A', clientA));
      clientB.on('message', (d) => handle(d, 'B', clientB));
      clientA.on('error', reject);
      clientB.on('error', reject);
    });
  }, 15000);
});
