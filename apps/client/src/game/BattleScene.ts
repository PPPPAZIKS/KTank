import {
  BULLET_RADIUS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PLAYER_MAX_HEALTH,
  TANK_RADIUS,
  type GameSnapshot,
  type PlayerInput
} from '@ktank/shared';
import Phaser from 'phaser';
import type { GameClient } from '../network';

interface TankView {
  body: Phaser.GameObjects.Container;
  healthBar: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private readonly tanks = new Map<string, TankView>();
  private readonly bullets = new Map<string, Phaser.GameObjects.Arc>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right' | 'fire', Phaser.Input.Keyboard.Key>;
  private latestSnapshot?: GameSnapshot;
  private previousHealth = new Map<string, number>();
  private sequence = 0;
  private lastSentInput = '';

  constructor(
    private readonly client: GameClient,
    private readonly playerId: string,
    private readonly onResult: (winnerId: string | null) => void
  ) {
    super('battle');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x101824);
    this.drawGrid();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      fire: Phaser.Input.Keyboard.KeyCodes.SPACE
    }) as typeof this.wasd;
    this.input.on('pointerdown', () => this.client.fire());
    this.wasd.fire.on('down', () => this.client.fire());
    this.client.onSnapshot((snapshot) => {
      this.latestSnapshot = snapshot;
      this.syncSnapshot(snapshot);
    });
  }

  update(): void {
    const localPlayer = this.latestSnapshot?.players.find((player) => player.id === this.playerId);
    if (!localPlayer || !localPlayer.alive) {
      return;
    }
    const pointer = this.input.activePointer;
    const input: PlayerInput = {
      sequence: ++this.sequence,
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
      angle: Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, pointer.worldX, pointer.worldY)
    };
    const serialized = JSON.stringify({ ...input, sequence: 0 });
    if (serialized !== this.lastSentInput || this.sequence % 3 === 0) {
      this.lastSentInput = serialized;
      this.client.sendInput(input);
    }
  }

  applyInitialSnapshot(snapshot: GameSnapshot): void {
    this.latestSnapshot = snapshot;
    if (this.sys.isActive()) {
      this.syncSnapshot(snapshot);
    }
  }

  private drawGrid(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x263548, 0.45);
    for (let x = 0; x <= GAME_WIDTH; x += 40) {
      graphics.lineBetween(x, 0, x, GAME_HEIGHT);
    }
    for (let y = 0; y <= GAME_HEIGHT; y += 40) {
      graphics.lineBetween(0, y, GAME_WIDTH, y);
    }
    graphics.lineStyle(4, 0x486078, 1).strokeRect(2, 2, GAME_WIDTH - 4, GAME_HEIGHT - 4);
  }

  private syncSnapshot(snapshot: GameSnapshot): void {
    for (const obstacle of snapshot.obstacles) {
      if (!this.children.getByName(obstacle.id)) {
        this.add.rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0x38495b)
          .setOrigin(0)
          .setStrokeStyle(3, 0x607991)
          .setName(obstacle.id);
      }
    }

    const playerIds = new Set(snapshot.players.map((player) => player.id));
    for (const [id, view] of this.tanks) {
      if (!playerIds.has(id)) {
        view.body.destroy();
        view.healthBar.destroy();
        view.name.destroy();
        this.tanks.delete(id);
      }
    }

    for (const player of snapshot.players) {
      let view = this.tanks.get(player.id);
      if (!view) {
        view = this.createTank(player.id, player.color, player.name);
        this.tanks.set(player.id, view);
      }
      view.body.setPosition(player.x, player.y).setRotation(player.angle).setAlpha(player.alive ? 1 : 0.22);
      view.name.setPosition(player.x, player.y - 39).setText(player.id === this.playerId ? `${player.name}（你）` : player.name);
      this.drawHealth(view.healthBar, player.x, player.y - 28, player.health);
      const oldHealth = this.previousHealth.get(player.id);
      if (oldHealth !== undefined && oldHealth > player.health) {
        this.showHit(player.x, player.y);
      }
      this.previousHealth.set(player.id, player.health);
    }

    const bulletIds = new Set(snapshot.bullets.map((bullet) => bullet.id));
    for (const [id, bullet] of this.bullets) {
      if (!bulletIds.has(id)) {
        bullet.destroy();
        this.bullets.delete(id);
      }
    }
    for (const bullet of snapshot.bullets) {
      let view = this.bullets.get(bullet.id);
      if (!view) {
        view = this.add.circle(bullet.x, bullet.y, BULLET_RADIUS, 0xffd166).setStrokeStyle(2, 0xfff2bd);
        this.bullets.set(bullet.id, view);
      }
      view.setPosition(bullet.x, bullet.y);
    }

    this.onResult(snapshot.winnerId);
  }

  private createTank(id: string, color: number, name: string): TankView {
    const shadow = this.add.ellipse(3, 5, 44, 30, 0x000000, 0.35);
    const body = this.add.rectangle(0, 0, TANK_RADIUS * 2, TANK_RADIUS * 1.65, color).setStrokeStyle(3, 0xe5f1ff);
    const turret = this.add.rectangle(15, 0, 30, 7, 0xd9e7f5).setOrigin(0.15, 0.5);
    const hub = this.add.circle(0, 0, 8, 0x182536).setStrokeStyle(2, 0xffffff);
    const container = this.add.container(0, 0, [shadow, body, turret, hub]).setName(id);
    const healthBar = this.add.graphics();
    const label = this.add.text(0, 0, name, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#eaf4ff'
    }).setOrigin(0.5);
    return { body: container, healthBar, name: label };
  }

  private drawHealth(graphics: Phaser.GameObjects.Graphics, x: number, y: number, health: number): void {
    graphics.clear();
    graphics.fillStyle(0x071019, 0.9).fillRoundedRect(x - 20, y, 40, 6, 3);
    const ratio = Math.max(0, health / PLAYER_MAX_HEALTH);
    graphics.fillStyle(ratio > 0.35 ? 0x59db88 : 0xff5f6d).fillRoundedRect(x - 19, y + 1, 38 * ratio, 4, 2);
  }

  private showHit(x: number, y: number): void {
    const flash = this.add.circle(x, y, 8, 0xffcc66, 0.9).setStrokeStyle(5, 0xff6b35);
    this.tweens.add({
      targets: flash,
      radius: 34,
      alpha: 0,
      duration: 260,
      onComplete: () => flash.destroy()
    });
  }
}
