import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer, Server } from 'http';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { setupChatServer } from '../src/server'; // Claude will need to update server.ts to export this

describe('In-memory Chat + Rooms', () => {
  let server: Server;
  let port: number;
  let clientA: WebSocket;
  let clientB: WebSocket;
  let clientC: WebSocket;
  let redisContainer: StartedTestContainer;

  beforeAll(async () => {
    // Chat routing now goes through Redis pub/sub, so spin up an ephemeral Redis.
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    server = createServer();
    setupChatServer(server); // New function for phase 2

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address !== 'string') {
          port = address.port;
        }
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    [clientA, clientB, clientC].forEach(c => {
      if (c && c.readyState === WebSocket.OPEN) c.close();
    });

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await redisContainer.stop();
  });

  const connectClient = (): Promise<WebSocket> => {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on('open', () => resolve(ws));
    });
  };

  it('should broadcast messages only to clients in the same room', async () => {
    clientA = await connectClient();
    clientB = await connectClient();
    clientC = await connectClient(); // Client C will be in a different room

    // 1. Join Rooms
    clientA.send(JSON.stringify({ type: 'join', roomId: 'lobby', username: 'Alice' }));
    clientB.send(JSON.stringify({ type: 'join', roomId: 'lobby', username: 'Bob' }));
    clientC.send(JSON.stringify({ type: 'join', roomId: 'secret-room', username: 'Charlie' }));

    // Small delay to ensure joins are processed
    await new Promise(r => setTimeout(r, 50));

    return new Promise<void>((resolve, reject) => {
      let clientBReceived = false;

      // Client B should receive the message from Alice
      clientB.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          expect(msg).toEqual({
            type: 'chat',
            roomId: 'lobby',
            sender: 'Alice',
            text: 'Hello Lobby!'
          });
          clientBReceived = true;
          resolve(); // Test passes when B gets the message
        } catch (e) {
          reject(e);
        }
      });

      // Client C should NOT receive the message (different room)
      clientC.on('message', () => {
        reject(new Error('Client C received a message meant for the lobby!'));
      });

      // 2. Alice sends a chat message
      clientA.send(JSON.stringify({ 
        type: 'chat', 
        roomId: 'lobby', 
        text: 'Hello Lobby!' 
      }));
    });
  });
});
