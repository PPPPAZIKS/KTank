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
      const existingRoom = manager.getRoom(request.roomId);
      if (existingRoom?.isConnected(request.sessionId)) {
        callback({ ok: false, message: '该玩家已在房间中' });
        return;
      }
      const resumedRoom = manager.reconnectPlayer(request.roomId, request.sessionId, request.name, socket.id);
      const room = resumedRoom ?? manager.getOrCreateRoom(request.roomId);
      if (!resumedRoom && !room.addPlayer(request.sessionId, request.name, socket.id)) {
        const status = room.snapshot().status;
        const message = status === 'waiting' || status === 'finished' ? '房间已满' : '对局已经开始';
        callback({ ok: false, message });
        return;
      }
      socket.data.roomId = request.roomId;
      socket.data.playerId = request.sessionId;
      socket.data.intentionalLeave = false;
      void socket.join(request.roomId);
      const snapshot = room.snapshot();
      callback({ ok: true, playerId: request.sessionId, sessionId: request.sessionId, snapshot });
      io.to(request.roomId).emit('snapshot', snapshot);
      process.stdout.write(`${resumedRoom ? 'reconnect' : 'join'} room=${request.roomId} player=${request.sessionId}\n`);
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
        socket.emit('notice', '仅房主可在本局结束且至少 2 人在线时重新开始');
        return;
      }
      io.to(roomId).emit('snapshot', room.snapshot());
    });

    socket.on('leaveRoom', (callback) => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      socket.data.intentionalLeave = true;
      if (roomId && playerId) {
        void socket.leave(roomId);
        manager.scheduleDisconnect(roomId, playerId, socket.id);
        process.stdout.write(`leave room=${roomId} player=${playerId} grace=30s\n`);
      }
      socket.data.roomId = undefined;
      socket.data.playerId = undefined;
      callback();
    });

    socket.on('disconnect', (reason) => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (roomId && playerId && !socket.data.intentionalLeave) {
        manager.scheduleDisconnect(roomId, playerId, socket.id);
        process.stdout.write(`disconnect room=${roomId} player=${playerId} reason=${reason}\n`);
      }
    });
  });
}
