import {
  BULLET_RADIUS,
  BULLET_SPEED,
  FIRE_COOLDOWN_MS,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_PLAYERS,
  OBSTACLES,
  PLAYER_MAX_HEALTH,
  TANK_RADIUS,
  TANK_SPEED,
  type BulletState,
  type GameSnapshot,
  type PlayerInput,
  type TankState
} from '@ktank/shared';
import { randomUUID } from 'node:crypto';
import { circleHitsRectangle, circlesOverlap } from './collision.js';

interface PlayerRecord extends TankState {
  input: PlayerInput;
  lastFireAt: number;
}

interface BulletRecord extends BulletState {
  velocityX: number;
  velocityY: number;
}

const COLORS = [0x45a3ff, 0xff5f6d, 0x4fd18b, 0xffc857];
const SPAWNS = [
  { x: 90, y: 90, angle: 0 },
  { x: GAME_WIDTH - 90, y: GAME_HEIGHT - 90, angle: Math.PI },
  { x: GAME_WIDTH - 90, y: 90, angle: Math.PI / 2 },
  { x: 90, y: GAME_HEIGHT - 90, angle: -Math.PI / 2 }
];

const EMPTY_INPUT: PlayerInput = {
  sequence: 0,
  up: false,
  down: false,
  left: false,
  right: false,
  angle: 0
};

export class GameRoom {
  readonly id: string;
  private readonly players = new Map<string, PlayerRecord>();
  private readonly bullets = new Map<string, BulletRecord>();
  private winnerId: string | null = null;

  constructor(id: string) {
    this.id = id;
  }

  get size(): number {
    return this.players.size;
  }

  addPlayer(id: string, name: string): boolean {
    if (this.players.size >= MAX_PLAYERS || this.players.has(id)) {
      return false;
    }
    const spawn = SPAWNS[this.players.size] ?? SPAWNS[0];
    if (!spawn) {
      return false;
    }
    this.players.set(id, {
      id,
      name,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      health: PLAYER_MAX_HEALTH,
      alive: true,
      color: COLORS[this.players.size] ?? 0xffffff,
      input: { ...EMPTY_INPUT, angle: spawn.angle },
      lastFireAt: 0
    });
    this.winnerId = null;
    return true;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    for (const [bulletId, bullet] of this.bullets) {
      if (bullet.ownerId === id) {
        this.bullets.delete(bulletId);
      }
    }
    this.resolveWinner();
  }

  setInput(id: string, input: PlayerInput): void {
    const player = this.players.get(id);
    if (!player || !player.alive || input.sequence < player.input.sequence) {
      return;
    }
    player.input = input;
  }

  fire(id: string, now = Date.now()): boolean {
    const player = this.players.get(id);
    if (!player || !player.alive || this.winnerId || now - player.lastFireAt < FIRE_COOLDOWN_MS) {
      return false;
    }
    player.lastFireAt = now;
    const offset = TANK_RADIUS + BULLET_RADIUS + 3;
    const directionX = Math.cos(player.angle);
    const directionY = Math.sin(player.angle);
    const bullet: BulletRecord = {
      id: randomUUID(),
      ownerId: id,
      x: player.x + directionX * offset,
      y: player.y + directionY * offset,
      velocityX: directionX * BULLET_SPEED,
      velocityY: directionY * BULLET_SPEED
    };
    this.bullets.set(bullet.id, bullet);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.winnerId) {
      return;
    }
    for (const player of this.players.values()) {
      this.updatePlayer(player, deltaSeconds);
    }
    this.updateBullets(deltaSeconds);
    this.resolveWinner();
  }

  restart(): void {
    this.bullets.clear();
    this.winnerId = null;
    let index = 0;
    for (const player of this.players.values()) {
      const spawn = SPAWNS[index] ?? SPAWNS[0];
      if (!spawn) {
        continue;
      }
      player.x = spawn.x;
      player.y = spawn.y;
      player.angle = spawn.angle;
      player.health = PLAYER_MAX_HEALTH;
      player.alive = true;
      player.input = { ...EMPTY_INPUT, angle: spawn.angle };
      player.lastFireAt = 0;
      index += 1;
    }
  }

  snapshot(now = Date.now()): GameSnapshot {
    const status = this.winnerId ? 'finished' : this.players.size >= 2 ? 'playing' : 'waiting';
    return {
      roomId: this.id,
      status,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        x: player.x,
        y: player.y,
        angle: player.angle,
        health: player.health,
        alive: player.alive,
        color: player.color
      })),
      bullets: [...this.bullets.values()].map((bullet) => ({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y
      })),
      obstacles: OBSTACLES.map((obstacle) => ({ ...obstacle })),
      winnerId: this.winnerId,
      serverTime: now
    };
  }

  private updatePlayer(player: PlayerRecord, deltaSeconds: number): void {
    if (!player.alive) {
      return;
    }
    let directionX = Number(player.input.right) - Number(player.input.left);
    let directionY = Number(player.input.down) - Number(player.input.up);
    const magnitude = Math.hypot(directionX, directionY);
    if (magnitude > 0) {
      directionX /= magnitude;
      directionY /= magnitude;
    }
    player.angle = player.input.angle;
    const nextX = Math.max(TANK_RADIUS, Math.min(GAME_WIDTH - TANK_RADIUS, player.x + directionX * TANK_SPEED * deltaSeconds));
    const nextY = Math.max(TANK_RADIUS, Math.min(GAME_HEIGHT - TANK_RADIUS, player.y + directionY * TANK_SPEED * deltaSeconds));
    const nextPosition = { x: nextX, y: nextY };
    const blocked = OBSTACLES.some((obstacle) => circleHitsRectangle(nextPosition, TANK_RADIUS, obstacle));
    if (!blocked) {
      player.x = nextX;
      player.y = nextY;
    }
  }

  private updateBullets(deltaSeconds: number): void {
    for (const [bulletId, bullet] of this.bullets) {
      bullet.x += bullet.velocityX * deltaSeconds;
      bullet.y += bullet.velocityY * deltaSeconds;
      const outside = bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT;
      const hitObstacle = OBSTACLES.some((obstacle) => circleHitsRectangle(bullet, BULLET_RADIUS, obstacle));
      if (outside || hitObstacle) {
        this.bullets.delete(bulletId);
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.alive || player.id === bullet.ownerId) {
          continue;
        }
        if (circlesOverlap(bullet, BULLET_RADIUS, player, TANK_RADIUS)) {
          player.health -= 1;
          player.alive = player.health > 0;
          this.bullets.delete(bulletId);
          break;
        }
      }
    }
  }

  private resolveWinner(): void {
    if (this.players.size < 2) {
      this.winnerId = null;
      return;
    }
    const alivePlayers = [...this.players.values()].filter((player) => player.alive);
    if (alivePlayers.length === 1) {
      this.winnerId = alivePlayers[0]?.id ?? null;
    }
  }
}
