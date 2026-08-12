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
  it('主动退出后保留状态并允许 30 秒内恢复', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const first = createClient(`http://localhost:${port}`);
    const second = createClient(`http://localhost:${port}`);
    sockets.push(first, second);

    await join(first, 'ROOM1', 'One', 'session-player-one');
    const secondJoin = await join(second, 'ROOM1', 'Two', 'session-player-two');
    expect(secondJoin.ok).toBe(true);

    const disconnectedSnapshotPromise = waitForSnapshot(first, (snapshot) =>
      snapshot.players.some((player) => player.id === 'session-player-two' && !player.connected)
    );
    await leave(second);
    const disconnectedSnapshot = await disconnectedSnapshotPromise;
    expect(disconnectedSnapshot.players).toHaveLength(2);

    const resumed = createClient(`http://localhost:${port}`);
    sockets.push(resumed);
    const response = await join(resumed, 'ROOM1', 'Two', 'session-player-two');
    expect(response.ok).toBe(true);
    if (response.ok) {
      const restored = response.snapshot.players.find((player) => player.id === 'session-player-two');
      expect(restored?.connected).toBe(true);
      expect(restored?.health).toBe(3);
      expect(restored?.alive).toBe(true);
    }
  });

  it('断线后可使用同一会话恢复原玩家', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const first = createClient(`http://localhost:${port}`);
    const second = createClient(`http://localhost:${port}`);
    sockets.push(first, second);
    await join(first, 'ROOM2', 'One', 'session-reconnect-one');
    const joined = await join(second, 'ROOM2', 'Two', 'session-reconnect-two');
    expect(joined.ok).toBe(true);
    second.disconnect();

    const disconnected = await waitForSnapshot(first, (snapshot) =>
      snapshot.players.some((player) => player.id === 'session-reconnect-two' && !player.connected)
    );
    expect(disconnected.players).toHaveLength(2);

    const resumed = createClient(`http://localhost:${port}`);
    sockets.push(resumed);
    const response = await join(resumed, 'ROOM2', 'Two', 'session-reconnect-two');
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.playerId).toBe('session-reconnect-two');
      expect(response.snapshot.players).toHaveLength(2);
      expect(response.snapshot.players.every((player) => player.connected)).toBe(true);
    }
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
      const response = await join(client, 'ROOM4', `Player ${index + 1}`, `session-room4-player-${index + 1}`);
      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.snapshot.players).toHaveLength(index + 1);
      }
    }
    const fifth = clients[4];
    if (!fifth) {
      throw new Error('客户端创建失败');
    }
    const rejected = await join(fifth, 'ROOM4', 'Player 5', 'session-room4-player-5');
    expect(rejected).toEqual({ ok: false, message: '房间已满' });
  });

  it('拒绝无效房间号', async () => {
    const server = createKTankServer(0);
    const port = await server.start();
    stopServer = server.stop;
    const client = createClient(`http://localhost:${port}`);
    sockets.push(client);
    const response = await join(client, '!', 'One', 'session-invalid-room');
    expect(response.ok).toBe(false);
  });
});

function join(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  roomId: string,
  name: string,
  sessionId: string
) {
  return new Promise<Parameters<Parameters<ClientToServerEvents['joinRoom']>[1]>[0]>((resolve) => {
    socket.emit('joinRoom', { roomId, name, sessionId }, resolve);
  });
}

function leave(socket: Socket<ServerToClientEvents, ClientToServerEvents>): Promise<void> {
  return new Promise((resolve) => socket.emit('leaveRoom', resolve));
}

function waitForSnapshot(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  predicate: (snapshot: Parameters<ServerToClientEvents['snapshot']>[0]) => boolean
): Promise<Parameters<ServerToClientEvents['snapshot']>[0]> {
  return new Promise((resolve) => {
    socket.on('snapshot', (snapshot) => {
      if (predicate(snapshot)) {
        resolve(snapshot);
      }
    });
  });
}
