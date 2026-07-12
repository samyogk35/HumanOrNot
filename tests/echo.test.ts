import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer, Server } from 'http';
import { setupEchoServer } from '../src/server'; // Claude needs to implement this

describe('Single WS Echo Server', () => {
  let server: Server;
  let wsClient: WebSocket;
  let port: number;

  beforeAll(async () => {
    // 1. Create a raw HTTP server
    server = createServer();
    
    // 2. Claude needs to attach the WebSocket server to this HTTP server
    setupEchoServer(server);

    // 3. Listen on a random available port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address !== 'string') {
          port = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should echo back the exact message sent by the client', async () => {
    return new Promise<void>((resolve, reject) => {
      wsClient = new WebSocket(`ws://localhost:${port}`);

      wsClient.on('open', () => {
        // Send a test message
        wsClient.send('Hello, HumanOrNot!');
      });

      wsClient.on('message', (data) => {
        try {
          // Assert that the server echoed it back
          expect(data.toString()).toBe('Hello, HumanOrNot!');
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      wsClient.on('error', (err) => {
        reject(err);
      });
    });
  });
});
