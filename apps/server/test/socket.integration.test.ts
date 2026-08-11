import type { ClientToServerEvents, ServerToClientEvents } from '@ktank/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { createKTankServer } from '../src/index.js';

const sockets: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
let stopServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  sockets.length = 0;
  await stopServer?.();
  stopServer = undefined;
});

describe('Socket 房间链路', () => {
  it('两个客户端加入同一房间并同步断线状态', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const first = createClient(`http://localhost:${port}`);
    const second = createClient(`http://localhost:${port}`);
    sockets.push(first, second);

    const firstJoin = await join(first, 'ROOM1', 'One');
    expect(firstJoin.ok).toBe(true);
    const secondJoin = await join(second, 'ROOM1', 'Two');
    expect(secondJoin.ok).toBe(true);
    if (!secondJoin.ok) {
      return;
    }
    expect(secondJoin.snapshot.players).toHaveLength(2);

    const disconnectedSnapshot = new Promise<number>((resolve) => {
      first.on('snapshot', (snapshot) => {
        if (snapshot.players.length === 1) {
          resolve(snapshot.players.length);
        }
      });
    });
    second.disconnect();
    await expect(disconnectedSnapshot).resolves.toBe(1);
  });

  it('允许四个客户端加入并拒绝第五个客户端', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const clients = Array.from({ length: 5 }, () => createClient(`http://localhost:${port}`));
    sockets.push(...clients);
    for (let index = 0; index < 4; index += 1) {
      const client = clients[index];
      if (!client) {
        throw new Error('客户端创建失败');
      }
      const response = await join(client, 'ROOM4', `Player ${index + 1}`);
      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.snapshot.players).toHaveLength(index + 1);
      }
    }
    const fifth = clients[4];
    if (!fifth) {
      throw new Error('客户端创建失败');
    }
    const rejected = await join(fifth, 'ROOM4', 'Player 5');
    expect(rejected).toEqual({ ok: false, message: '房间已满' });
  });

  it('拒绝无效房间号', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const client = createClient(`http://localhost:${port}`);
    sockets.push(client);
    const response = await join(client, '!', 'One');
    expect(response.ok).toBe(false);
  });
});

function join(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  roomId: string,
  name: string
) {
  return new Promise<Parameters<Parameters<ClientToServerEvents['joinRoom']>[1]>[0]>((resolve) => {
    socket.emit('joinRoom', { roomId, name }, resolve);
  });
}
