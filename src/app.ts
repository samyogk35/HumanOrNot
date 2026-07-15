import express, { Express, Request, Response } from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { parse } from 'url';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Kafka, Producer } from 'kafkajs';
import { users, messages } from './schema';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './auth';
import {
  serializeMessage,
  parseMessage,
  createRedisClient,
  channelForRoom,
} from './redis-glue';
import { CHAT_TOPIC } from './kafka-consumer';
import { GameStateManager } from './game/state-machine';
import { GameOrchestrator } from './game/orchestrator';
import { mockBotResponder } from './game/mock-responder';

// Each createApp() call is a fully self-contained instance. No shared module
// state, so multiple instances can run side-by-side in one process.
interface AppInstance {
  pool: Pool;
  wss: WebSocketServer;
  publisher: Redis;
  subscriber: Redis;
  producer?: Producer;
  orchestrator: GameOrchestrator;
  stateManager: GameStateManager;
}
const instances = new Set<AppInstance>();

async function teardown(inst: AppInstance): Promise<void> {
  if (!instances.has(inst)) return;
  instances.delete(inst);
  inst.wss.close();
  inst.orchestrator.dispose();
  await inst.stateManager.close().catch(() => {});
  await inst.publisher.quit().catch(() => {});
  await inst.subscriber.quit().catch(() => {});
  if (inst.producer) {
    await inst.producer.disconnect().catch(() => {});
  }
  await inst.pool.end().catch(() => {});
}

export async function createApp(): Promise<{ app: Express; server: Server }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Idle clients can error (e.g. server shutdown terminating the connection);
  // without a listener pg re-throws it as an uncaught exception.
  pool.on('error', () => {});
  const db: NodePgDatabase = drizzle(pool);

  // Sync the Drizzle-defined users table to the DB.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Unique per app instance so a load balancer's fan-out is observable.
  const serverId = randomUUID();

  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    return res.status(200).json({ status: 'ok', serverId });
  });

  app.post('/signup', async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (existing.length > 0) {
      return res.status(409).json({ error: 'username already taken' });
    }

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({ username, passwordHash })
      .returning();

    const token = generateToken({ userId: created.id, username: created.username });
    return res.status(201).json({ token });
  });

  app.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = generateToken({ userId: user.id, username: user.username });
    return res.status(200).json({ token });
  });

  const server = createServer(app);

  // Shared publisher; a subscribed connection cannot also publish.
  const publisher = createRedisClient();

  // Kafka write buffer. When configured, chat writes go through Kafka instead
  // of a direct DB insert; a background consumer batch-writes them to Postgres.
  let producer: Producer | undefined;
  const kafkaBrokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
  if (kafkaBrokers.length > 0) {
    const kafka = new Kafka({ clientId: 'chat-producer', brokers: kafkaBrokers });
    producer = kafka.producer();
    await producer.connect();
  }

  // One subscriber per instance (connected once, up front), plus a local map of
  // room channel -> connected sockets on THIS instance. Redis fans out across
  // instances; this map fans out to the local sockets. Keeping the subscriber
  // pre-connected means SUBSCRIBE on join is a single fast round-trip instead of
  // paying connection setup inside the join critical path.
  const subscriber = createRedisClient();
  const roomClients = new Map<string, Set<WebSocket>>();

  subscriber.on('message', (channel, payload) => {
    const clients = roomClients.get(channel);
    if (!clients) return;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Game control plane. Phase durations are env-tunable (integration tests shrink
  // them). The mock responder stands in for the LLM until Phase 13; swapping it
  // for the Ollama-backed generateBotResponse is a one-line change here.
  const stateManager = new GameStateManager(process.env.REDIS_URL!);
  const orchestrator = new GameOrchestrator({
    stateStore: stateManager,
    generateResponse: mockBotResponder,
    broadcast: (roomId, payload) => {
      // .catch swallows the race where a publish is issued as the instance is
      // being torn down (publisher already quit -> "Connection is closed").
      publisher
        .publish(channelForRoom(roomId), serializeMessage(payload))
        .catch(() => {});
    },
    chatDurationMs: Number(process.env.CHAT_DURATION_MS ?? 180_000),
    voteDurationMs: Number(process.env.VOTE_DURATION_MS ?? 60_000),
    botCadenceMs: Number(process.env.BOT_CADENCE_MS ?? 15_000),
  });

  // WS server with manual upgrade so we can reject unauthenticated clients.
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    const user = (ws as any).user as { userId: number; username: string };
    const joinedChannels = new Set<string>();

    ws.on('message', async (data) => {
      let msg: any;
      try {
        msg = parseMessage(data.toString());
      } catch {
        return; // ignore non-JSON
      }

      if (msg.type === 'join') {
        const channel = channelForRoom(msg.roomId);
        let clients = roomClients.get(channel);
        if (!clients) {
          clients = new Set();
          roomClients.set(channel, clients);
          // Only hit Redis the first time this instance cares about the room.
          await subscriber.subscribe(channel);
        }
        clients.add(ws);
        joinedChannels.add(channel);
        // Add to the game roster (deduped) so start/voting see this player.
        orchestrator.addPlayer(msg.roomId, {
          id: user.userId,
          username: user.username,
        });
        return;
      }

      if (msg.type === 'chat') {
        const record = {
          roomId: msg.roomId,
          content: msg.text,
          senderId: user.userId,
        };
        if (producer) {
          // Buffer the write through Kafka (consumer batch-inserts later).
          await producer.send({
            topic: CHAT_TOPIC,
            messages: [{ value: JSON.stringify(record) }],
          });
        } else {
          // No Kafka configured: fall back to a direct synchronous insert.
          await db.insert(messages).values(record);
        }
        // Feed the bot's context window, then fan out via Redis pub/sub.
        orchestrator.recordMessage(msg.roomId, user.username, msg.text);
        const payload = serializeMessage({
          type: 'chat',
          roomId: msg.roomId,
          id: randomUUID(),
          senderId: String(user.userId),
          sender: user.username,
          text: msg.text,
        });
        await publisher.publish(channelForRoom(msg.roomId), payload);
        return;
      }

      if (msg.type === 'start') {
        // Any room member may start; this instance then owns the game's timers.
        await orchestrator.startGame(msg.roomId);
        return;
      }

      if (msg.type === 'vote') {
        try {
          await orchestrator.castVote(msg.roomId, {
            voterId: user.userId,
            targetId: Number(msg.targetId),
          });
        } catch (err) {
          // Rejected votes (wrong phase / already voted) go only to this socket.
          ws.send(
            serializeMessage({
              type: 'error',
              code: 'vote_rejected',
              message: err instanceof Error ? err.message : 'vote rejected',
            })
          );
        }
        return;
      }
    });

    ws.on('close', () => {
      for (const channel of joinedChannels) {
        const clients = roomClients.get(channel);
        clients?.delete(ws);
        if (clients && clients.size === 0) {
          roomClients.delete(channel);
          void subscriber.unsubscribe(channel);
        }
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const { query } = parse(req.url ?? '', true);
    const token = typeof query.token === 'string' ? query.token : undefined;

    const reject = () => {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    };

    if (!token) return reject();

    let payload: any;
    try {
      payload = verifyToken(token);
    } catch {
      return reject();
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      (ws as any).user = payload;
      wss.emit('connection', ws, req);
    });
  });

  const instance: AppInstance = {
    pool,
    wss,
    publisher,
    subscriber,
    producer,
    orchestrator,
    stateManager,
  };
  instances.add(instance);
  // Closing the server tears down this instance's DB/Redis connections, so a
  // test that only calls server.close() still cleans up.
  server.on('close', () => {
    void teardown(instance);
  });

  return { app, server };
}

export async function closeApp(): Promise<void> {
  for (const inst of [...instances]) {
    await teardown(inst);
  }
}
