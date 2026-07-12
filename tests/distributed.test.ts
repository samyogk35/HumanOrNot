import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { PostgreSqlContainer, StartedPostgreSqlContainer, GenericContainer, StartedTestContainer } from 'testcontainers';
import { createApp, closeApp } from '../src/app';

describe('Distributed Proof (Multi-Instance)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  
  let app1: any, server1: any, port1: number;
  let app2: any, server2: any, port2: number;
  
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    // 1. Spin up shared infrastructure
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    
    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    process.env.JWT_SECRET = 'distributed-secret';

    // 2. Boot Instance A
    const instanceA = await createApp();
    app1 = instanceA.app;
    server1 = instanceA.server;
    await new Promise<void>((resolve) => {
      server1.listen(0, () => {
        const address = server1.address();
        port1 = typeof address === 'string' ? 80 : address.port;
        resolve();
      });
    });

    // 3. Boot Instance B (Shares the same ENV variables for DB/Redis)
    const instanceB = await createApp();
    app2 = instanceB.app;
    server2 = instanceB.server;
    await new Promise<void>((resolve) => {
      server2.listen(0, () => {
        const address = server2.address();
        port2 = typeof address === 'string' ? 80 : address.port;
        resolve();
      });
    });

    // 4. Seed users across the different instances (just to prove they share the DB)
    const resA = await request(app1).post('/signup').send({ username: 'userA', password: 'pw' });
    tokenA = resA.body.token;

    const resB = await request(app2).post('/signup').send({ username: 'userB', password: 'pw' });
    tokenB = resB.body.token;
  }, 45000); // 45s timeout for downloading 2 containers

  afterAll(async () => {
    // Close servers (which should cleanly disconnect from DB/Redis)
    await server1.close();
    await server2.close();
    
    // Stop containers
    await pgContainer.stop();
    await redisContainer.stop();
  });

  it('should route a message from Instance A to a client on Instance B', async () => {
    return new Promise<void>((resolve, reject) => {
      // Connect Client A to Instance 1
      const clientA = new WebSocket(`ws://localhost:${port1}?token=${tokenA}`);
      
      // Connect Client B to Instance 2
      const clientB = new WebSocket(`ws://localhost:${port2}?token=${tokenB}`);

      let connectedCount = 0;
      const onOpen = () => {
        connectedCount++;
        if (connectedCount === 2) {
          // Both clients are connected to different servers. Have them join the same room.
          clientA.send(JSON.stringify({ type: 'join', roomId: 'global-room' }));
          clientB.send(JSON.stringify({ type: 'join', roomId: 'global-room' }));

          // Give Redis a tiny bit of time to establish the subscription for Client B
          setTimeout(() => {
            // Client A (on server 1) sends the message
            clientA.send(JSON.stringify({ type: 'chat', roomId: 'global-room', text: 'cross-server broadcast' }));
          }, 100);
        }
      };

      clientA.on('open', onOpen);
      clientB.on('open', onOpen);

      // Listen on Client B (on server 2) to see if it gets the message from A
      clientB.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'chat' && msg.text === 'cross-server broadcast') {
            // Success! The message traversed: 
            // ClientA -> Server1 -> Redis -> Server2 -> ClientB
            clientA.close();
            clientB.close();
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      });

      clientA.on('error', reject);
      clientB.on('error', reject);

      // Fail-safe timeout
      setTimeout(() => reject(new Error('Timeout waiting for message to cross instances')), 5000);
    });
  });
});
