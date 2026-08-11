import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from '@ktank/shared';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { GameManager } from './game/GameManager.js';
import { registerSocketHandlers } from './socket/registerHandlers.js';

export function createKTankServer(port = Number(process.env.PORT ?? 3001)) {
  const app = express();
  app.use(cors());
  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  const httpServer = createServer(app);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: '*' }
  });
  const manager = new GameManager(io);
  registerSocketHandlers(io, manager);

  return {
    app,
    io,
    manager,
    start: async () => {
      await new Promise<void>((resolve) => {
        httpServer.listen(port, resolve);
      });
      manager.start();
      const address = httpServer.address();
      return typeof address === 'object' && address ? address.port : port;
    },
    stop: async () => {
      manager.stop();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
  };
}

if (process.env.NODE_ENV !== 'test') {
  const server = createKTankServer();
  server.start().then((port) => {
    process.stdout.write(`KTank server listening on http://localhost:${port}\n`);
  });
}
