import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { PostgreSqlContainer, GenericContainer, StartedTestContainer } from 'testcontainers';
import { createApp, closeApp } from '../src/app';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('Nginx Load Balancer', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let nginxContainer: StartedTestContainer;
  
  let app1: any, server1: any, port1: number;
  let app2: any, server2: any, port2: number;
  
  let nginxPort: number;
  let validToken: string;
  const nginxConfPath = join(__dirname, 'nginx-test.conf');

  beforeAll(async () => {
    // 1. Shared Infrastructure
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    
    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    process.env.JWT_SECRET = 'lb-secret';

    // 2. Boot Instance 1
    const instanceA = await createApp();
    app1 = instanceA.app;
    server1 = instanceA.server;
    await new Promise<void>((resolve) => {
      server1.listen(0, () => {
        port1 = (server1.address() as any).port;
        resolve();
      });
    });

    // 3. Boot Instance 2
    const instanceB = await createApp();
    app2 = instanceB.app;
    server2 = instanceB.server;
    await new Promise<void>((resolve) => {
      server2.listen(0, () => {
        port2 = (server2.address() as any).port;
        resolve();
      });
    });

    // 4. Generate dynamic Nginx config pointing to the host's random Node ports
    const nginxConf = `
      events {}
      http {
        upstream backend {
          server host.docker.internal:${port1};
          server host.docker.internal:${port2};
        }
        server {
          listen 80;
          location / {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "Upgrade";
            proxy_set_header Host $host;
          }
        }
      }
    `;
    writeFileSync(nginxConfPath, nginxConf);

    // 5. Boot Nginx Container
    nginxContainer = await new GenericContainer('nginx:alpine')
      .withExposedPorts(80)
      .withBindMounts([{ source: nginxConfPath, target: '/etc/nginx/nginx.conf' }])
      // This ensures host.docker.internal works even on Linux CI environments
      .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
      .start();
      
    nginxPort = nginxContainer.getMappedPort(80);

    // 6. Sign up a user directly on Instance 1 to get a valid token
    const res = await request(app1).post('/signup').send({ username: 'lb_user', password: 'pw' });
    validToken = res.body.token;

  }, 45000);

  afterAll(async () => {
    await server1.close();
    await server2.close();
    await nginxContainer.stop();
    await pgContainer.stop();
    await redisContainer.stop();
    
    try {
      unlinkSync(nginxConfPath);
    } catch (e) {}
  });

  it('HTTP: should round-robin requests between instances via /health', async () => {
    const serverIds = new Set<string>();
    
    // Hit the Nginx proxy 10 times
    for (let i = 0; i < 10; i++) {
      // Note we hit localhost:nginxPort, NOT the Express ports directly!
      const res = await request(`http://localhost:${nginxPort}`).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.serverId).toBeDefined();
      serverIds.add(res.body.serverId);
    }

    // Since we have 2 upstreams, Nginx round-robin should have hit both
    expect(serverIds.size).toBe(2);
  });

  it('WebSocket: should upgrade successfully through the Nginx proxy', async () => {
    return new Promise<void>((resolve, reject) => {
      // Connect WS directly to Nginx
      const ws = new WebSocket(`ws://localhost:${nginxPort}?token=${validToken}`);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join', roomId: 'proxy-room' }));
        ws.send(JSON.stringify({ type: 'chat', roomId: 'proxy-room', text: 'hello proxy' }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'chat' && msg.text === 'hello proxy') {
            ws.close();
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      });

      ws.on('unexpected-response', (req, res) => reject(new Error(`Proxy rejected WS with ${res.statusCode}`)));
      ws.on('error', reject);
    });
  });
});
