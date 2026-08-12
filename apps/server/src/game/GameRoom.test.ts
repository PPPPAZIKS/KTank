import { TANK_RADIUS } from '@ktank/shared';
import { describe, expect, it } from 'vitest';
import { GameRoom } from './GameRoom.js';

function input(overrides: Partial<Parameters<GameRoom['setInput']>[1]> = {}) {
  return {
    sequence: 1,
    up: false,
    down: false,
    left: false,
    right: false,
    angle: 0,
    ...overrides
  };
}

describe('GameRoom', () => {
  it('等待房主开局后才允许移动', () => {
    const room = new GameRoom('ABC', () => []);
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
    room.setInput('one', input({ left: true }));
    room.update(10);
    expect(room.snapshot().players[0]?.x).toBe(90);
    expect(room.start('two')).toBe(false);
    expect(room.start('one')).toBe(true);
    room.setInput('one', input({ left: true }));
    room.update(10);
    expect(room.snapshot().players[0]?.x).toBe(TANK_RADIUS);
  });

  it('处理射击命中并产生一致胜负结果', () => {
    const room = new GameRoom('ABC', () => []);
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
    room.start('one');
    const players = room.snapshot().players;
    const first = players.find((player) => player.id === 'one');
    const second = players.find((player) => player.id === 'two');
    expect(first?.x).toBeLessThan(second?.x ?? 0);

    room.setInput('one', input({ down: true }));
    room.update(110 / 180);
    room.setInput('one', input({ sequence: 2, angle: 0 }));
    room.setInput('two', input({ up: true, angle: Math.PI }));
    room.update(350 / 180);
    room.setInput('two', input({ sequence: 2, angle: Math.PI }));

    for (let shot = 0; shot < 3; shot += 1) {
      expect(room.fire('one', 1000 + shot * 2000)).toBe(true);
      for (let tick = 0; tick < 130; tick += 1) {
        room.update(1 / 60);
      }
    }

    const snapshot = room.snapshot();
    expect(snapshot.players.find((player) => player.id === 'two')?.alive).toBe(false);
    expect(snapshot.winnerId).toBe('one');
    expect(snapshot.status).toBe('finished');
    expect(room.restart('two')).toBe(false);
    expect(room.restart('one')).toBe(true);
    expect(room.snapshot().status).toBe('playing');
    expect(room.snapshot().players.every((player) => player.alive)).toBe(true);
  });

  it('断线保留期间冻结血量并在重连后恢复', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One', 'socket-one');
    room.addPlayer('two', 'Two', 'socket-two');
    room.start('one');
    room.setInput('one', input({ down: true }));
    room.update(110 / 180);
    room.setInput('one', input({ sequence: 2, angle: 0 }));
    room.setInput('two', input({ up: true, angle: Math.PI }));
    room.update(350 / 180);
    room.setInput('two', input({ sequence: 2, angle: Math.PI }));
    const healthBeforeDisconnect = room.snapshot().players.find((player) => player.id === 'two')?.health;

    expect(room.markDisconnected('two', 'socket-two')).toBe(true);
    expect(room.fire('one', 1000)).toBe(true);
    for (let tick = 0; tick < 130; tick += 1) {
      room.update(1 / 60);
    }
    expect(room.snapshot().players.find((player) => player.id === 'two')?.health).toBe(healthBeforeDisconnect);

    expect(room.reconnectPlayer('two', 'Two', 'socket-two-new')).toBe(true);
    const restored = room.snapshot().players.find((player) => player.id === 'two');
    expect(restored?.connected).toBe(true);
    expect(restored?.alive).toBe(true);
    expect(restored?.health).toBe(healthBeforeDisconnect);
  });

  it('允许进行中退出的玩家重新加入并等待下一局', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
    room.addPlayer('three', 'Three');
    room.start('one');
    room.removePlayer('two');
    expect(room.addPlayer('two-new', 'Two')).toBe(true);
    const rejoined = room.snapshot().players.find((player) => player.id === 'two-new');
    expect(rejoined?.connected).toBe(true);
    expect(rejoined?.alive).toBe(false);
    expect(rejoined?.health).toBe(0);
    expect(room.snapshot().status).toBe('playing');
  });

  it('忽略旧连接在玩家重连后的延迟断开', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One', 'socket-old');
    room.reconnectPlayer('one', 'One', 'socket-new');
    expect(room.markDisconnected('one', 'socket-old')).toBe(false);
    expect(room.snapshot().players[0]?.connected).toBe(true);
  });

  it('支持四个唯一槽位并在断线后安全补位', () => {
    const room = new GameRoom('ABC');
    for (let index = 1; index <= 4; index += 1) {
      expect(room.addPlayer(`p${index}`, `Player ${index}`)).toBe(true);
    }
    expect(room.addPlayer('p5', 'Player 5')).toBe(false);
    const fullSnapshot = room.snapshot();
    expect(new Set(fullSnapshot.players.map((player) => `${player.x},${player.y}`)).size).toBe(4);
    expect(new Set(fullSnapshot.players.map((player) => player.color)).size).toBe(4);

    const departed = fullSnapshot.players.find((player) => player.id === 'p2');
    room.removePlayer('p2');
    expect(room.addPlayer('p5', 'Player 5')).toBe(true);
    const replacement = room.snapshot().players.find((player) => player.id === 'p5');
    expect(replacement?.x).toBe(departed?.x);
    expect(replacement?.y).toBe(departed?.y);
    expect(replacement?.color).toBe(departed?.color);
  });

  it('移除断线玩家并转移房主', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
    room.removePlayer('one');
    const snapshot = room.snapshot();
    expect(snapshot.players.map((player) => player.id)).toEqual(['two']);
    expect(snapshot.hostId).toBe('two');
  });
});
