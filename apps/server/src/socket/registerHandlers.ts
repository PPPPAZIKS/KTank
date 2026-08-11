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
        const message = room.snapshot().status === 'waiting' ? '房间已满' : '对局已经开始';
        callback({ ok: false, message });
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

    socket.on('startGame', () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) {
        return;
      }
      const room = manager.getRoom(roomId);
      if (!room?.start(playerId)) {
        socket.emit('notice', '只有房主能在 2～4 人到齐后开始游戏');
        return;
      }
      io.to(roomId).emit('snapshot', room.snapshot());
    });

    socket.on('restart', () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) {
        return;
      }
      const room = manager.getRoom(roomId);
      if (!room?.restart(playerId)) {
        socket.emit('notice', '只有房主能在本局结束后重新开始');
        return;
      }
      io.to(roomId).emit('snapshot', room.snapshot());
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
