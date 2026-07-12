import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  serializeMessage,
  parseMessage,
  createRedisClient,
  channelForRoom,
} from './redis-glue';

export function setupEchoServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data, isBinary) => {
      ws.send(data, { binary: isBinary });
    });
  });

  return wss;
}

export function setupChatServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server });

  // Shared publisher; a subscribed connection cannot also publish, so keep separate.
  const publisher = createRedisClient();

  wss.on('connection', (ws: WebSocket) => {
    // Each connection gets its own subscriber client.
    const subscriber = createRedisClient();
    let username: string | undefined;
    let currentRoom: string | undefined;

    // Anything published to a channel this connection is subscribed to
    // gets forwarded straight to the WS client.
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
        // leave previous room's channel if any
        if (currentRoom) {
          await subscriber.unsubscribe(channelForRoom(currentRoom));
        }
        currentRoom = msg.roomId;
        username = msg.username;
        await subscriber.subscribe(channelForRoom(msg.roomId));
        return;
      }

      if (msg.type === 'chat') {
        const payload = serializeMessage({
          type: 'chat',
          roomId: msg.roomId,
          sender: username,
          text: msg.text,
        });
        await publisher.publish(channelForRoom(msg.roomId), payload);
        return;
      }
    });

    ws.on('close', () => {
      subscriber.quit();
    });
  });

  return wss;
}
