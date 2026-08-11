import {
  SERVER_TICK_RATE,
  SNAPSHOT_RATE,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData
} from '@ktank/shared';
import type { Server } from 'socket.io';
import { GameRoom } from './GameRoom.js';

export class GameManager {
  private readonly rooms = new Map<string, GameRoom>();
  private loopTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private lastUpdateAt = Date.now();

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {}

  getOrCreateRoom(roomId: string): GameRoom {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new GameRoom(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  removePlayer(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }
    room.removePlayer(playerId);
    if (room.size === 0) {
      this.rooms.delete(roomId);
    } else {
      this.io.to(roomId).emit('snapshot', room.snapshot());
    }
  }

  start(): void {
    if (this.loopTimer || this.snapshotTimer) {
      return;
    }
    this.lastUpdateAt = Date.now();
    this.loopTimer = setInterval(() => {
      const now = Date.now();
      const deltaSeconds = Math.min((now - this.lastUpdateAt) / 1000, 0.1);
      this.lastUpdateAt = now;
      for (const room of this.rooms.values()) {
        room.update(deltaSeconds);
      }
    }, 1000 / SERVER_TICK_RATE);
    this.snapshotTimer = setInterval(() => {
      for (const room of this.rooms.values()) {
        this.io.to(room.id).emit('snapshot', room.snapshot());
      }
    }, 1000 / SNAPSHOT_RATE);
  }

  stop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = undefined;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }
}
