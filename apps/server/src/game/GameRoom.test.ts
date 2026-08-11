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
  it('限制玩家不越过地图边界', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One');
    room.setInput('one', input({ left: true }));
    room.update(10);
    expect(room.snapshot().players[0]?.x).toBe(TANK_RADIUS);
  });

  it('处理射击命中并产生一致胜负结果', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
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
  });

  it('移除断线玩家', () => {
    const room = new GameRoom('ABC');
    room.addPlayer('one', 'One');
    room.addPlayer('two', 'Two');
    room.removePlayer('two');
    expect(room.snapshot().players.map((player) => player.id)).toEqual(['one']);
  });
});
