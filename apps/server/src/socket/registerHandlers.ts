import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from '@ktank/shared';
import type { Server } from 'socket.io';
import { GameManager } from '../game/GameManager.js';
import { normalizeInput, normalizeJoinRequest } from '../game/validation.js';

export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  manager: GameManager
): void {
  io.on('connection', (socket) => {
    socket.on('joinRoom', (rawRequest, callback) => {
      const request = normalizeJoinRequest(rawRequest);
      if (!request) {
        callback({ ok: false, message: '房间号需为 3-12 位字母或数字，昵称不能为空' });
        return;
      }
      if (socket.data.roomId) {
        callback({ ok: false, message: '当前连接已加入房间' });
        return;
      }
      const room = manager.getOrCreateRoom(request.roomId);
      if (!room.addPlayer(socket.id, request.name)) {
        callback({ ok: false, message: '房间已满' });
        return;
      }
      socket.data.roomId = request.roomId;
      socket.data.playerId = socket.id;
      void socket.join(request.roomId);
      const snapshot = room.snapshot();
      callback({ ok: true, playerId: socket.id, snapshot });
      io.to(request.roomId).emit('snapshot', snapshot);
    });

    socket.on('playerInput', (rawInput) => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      const input = normalizeInput(rawInput);
      if (!roomId || !playerId || !input) {
        return;
      }
      manager.getRoom(roomId)?.setInput(playerId, input);
    });

    socket.on('fire', () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) {
        return;
      }
      manager.getRoom(roomId)?.fire(playerId);
    });

    socket.on('restart', () => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }
      const room = manager.getRoom(roomId);
      room?.restart();
      if (room) {
        io.to(roomId).emit('snapshot', room.snapshot());
      }
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (roomId && playerId) {
        manager.removePlayer(roomId, playerId);
      }
    });
  });
}
