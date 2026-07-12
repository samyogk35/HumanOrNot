import express, { Express, Request, Response } from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { parse } from 'url';
import Redis from 'ioredis';
import { users, messages } from './schema';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './auth';
import {
  serializeMessage,
  parseMessage,
  createRedisClient,
  channelForRoom,
} from './redis-glue';

let pool: Pool | undefined;
let wss: WebSocketServer | undefined;
let publisher: Redis | undefined;

export async function createApp(): Promise<{ app: Express; server: Server }> {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

  const app = express();
  app.use(express.json());

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
  publisher = createRedisClient();

  // WS server with manual upgrade so we can reject unauthenticated clients.
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    const user = (ws as any).user as { userId: number; username: string };
    const subscriber = createRedisClient();

    subscriber.on('message', (_channel, payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });

    ws.on('message', async (data) => {
      let msg: any;
      try {
        msg = parseMessage(data.toString());
      } catch {
        return; // ignore non-JSON
      }

      if (msg.type === 'join') {
        await subscriber.subscribe(channelForRoom(msg.roomId));
        return;
      }

      if (msg.type === 'chat') {
        // Naive synchronous write: insert straight into Postgres.
        await db.insert(messages).values({
          roomId: msg.roomId,
          content: msg.text,
          senderId: user.userId,
        });
        // Fan out to the room's subscribers via Redis pub/sub.
        const payload = serializeMessage({
          type: 'chat',
          roomId: msg.roomId,
          sender: user.username,
          text: msg.text,
        });
        await publisher!.publish(channelForRoom(msg.roomId), payload);
        return;
      }
    });

    ws.on('close', () => {
      subscriber.quit();
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

    wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      (ws as any).user = payload;
      wss!.emit('connection', ws, req);
    });
  });

  return { app, server };
}

export async function closeApp(): Promise<void> {
  if (wss) {
    wss.close();
    wss = undefined;
  }
  if (publisher) {
    await publisher.quit();
    publisher = undefined;
  }
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
