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
import body0Url from '../assets/tanks/body-0.png';
import body1Url from '../assets/tanks/body-1.png';
import body2Url from '../assets/tanks/body-2.png';
import body3Url from '../assets/tanks/body-3.png';
import gun0Url from '../assets/tanks/gun-0.png';
import gun1Url from '../assets/tanks/gun-1.png';
import gun2Url from '../assets/tanks/gun-2.png';
import gun3Url from '../assets/tanks/gun-3.png';
import obstacle0Url from '../assets/obstacles/obstacle-0.png';
import obstacle1Url from '../assets/obstacles/obstacle-1.png';
import groundUrl from '../assets/maps/ground.png';

// 服务器按槽位分配的颜色 → 对应素材编号
const colorToTankIndex: Record<number, number> = {
  0x45a3ff: 0, // 蓝
  0xff5f6d: 1, // 红
  0x4fd18b: 2, // 绿
  0xffc857: 3  // 黄
};

// 炮塔素材默认炮管朝下，炮塔中心作为旋转锚点；逻辑 angle=0 表示朝右
const GUN_TEX_OFFSET = -Math.PI / 2;
// 车身素材默认朝上，移动方向需要加 90° 映射到 Phaser 旋转坐标
const BODY_TEX_OFFSET = Math.PI / 2;
const TANK_TEX_WIDTH = TANK_RADIUS * 2;

const BODY_KEYS = ['tankBody0', 'tankBody1', 'tankBody2', 'tankBody3'];
const GUN_KEYS = ['tankGun0', 'tankGun1', 'tankGun2', 'tankGun3'];
const BODY_URLS = [body0Url, body1Url, body2Url, body3Url];
const GUN_URLS = [gun0Url, gun1Url, gun2Url, gun3Url];

// 裁剪图内的真实旋转锚点：车身黑洞中心、炮塔圆心
const BODY_PIVOTS = [
  { x: 159, y: 194 },
  { x: 158, y: 195 },
  { x: 158, y: 195 },
  { x: 159, y: 194 }
];
const GUN_PIVOTS = [
  { x: 79, y: 76 },
  { x: 79, y: 76 },
  { x: 79, y: 76 },
  { x: 79, y: 76 }
];

interface TankView {
  body: Phaser.GameObjects.Container;
  bodyLayer: Phaser.GameObjects.Container;
  turretLayer: Phaser.GameObjects.Container;
  car: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image;
  healthBar: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private readonly tanks = new Map<string, TankView>();
  private readonly bullets = new Map<string, Phaser.GameObjects.Arc>();
  private readonly obstacleViews = new Map<string, Phaser.GameObjects.Image>();
  private readonly obstacleSigs = new Map<string, string>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right' | 'fire', Phaser.Input.Keyboard.Key>;
  private latestSnapshot?: GameSnapshot;
  private previousHealth = new Map<string, number>();
  private previousPositions = new Map<string, { x: number; y: number }>();
  private impactIds = new Set<string>();
  private bodyAngles = new Map<string, number>();
  private sequence = 0;
  private lastSentInput = '';

  constructor(
    private readonly client: GameClient,
    private readonly playerId: string,
    private readonly onSnapshot: (snapshot: GameSnapshot) => void
  ) {
    super('battle');
  }

  preload(): void {
    this.load.image('ground', groundUrl);
    for (let i = 0; i < BODY_URLS.length; i++) {
      this.load.image(BODY_KEYS[i]!, BODY_URLS[i]);
      this.load.image(GUN_KEYS[i]!, GUN_URLS[i]);
    }
    this.load.image('obstacle0', obstacle0Url);
    this.load.image('obstacle1', obstacle1Url);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x101824);
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'ground')
      .setOrigin(0.5)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(0);
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
    if (!localPlayer || !localPlayer.alive || this.latestSnapshot?.status !== 'playing') {
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
      let view = this.obstacleViews.get(obstacle.id);
      if (!view) {
        view = this.add.image(0, 0, obstacle.type === 1 ? 'obstacle1' : 'obstacle0').setOrigin(0.5);
        this.obstacleViews.set(obstacle.id, view);
        this.obstacleSigs.set(obstacle.id, '');
      }
      // 同一 id 的位置/尺寸/类型变化时同步更新（restart 后布局会变）
      const sig = `${obstacle.x},${obstacle.y},${obstacle.width},${obstacle.height},${obstacle.type ?? 0}`;
      if (this.obstacleSigs.get(obstacle.id) !== sig) {
        view.setPosition(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
        view.setDisplaySize(obstacle.width, obstacle.height);
        view.setTexture(obstacle.type === 1 ? 'obstacle1' : 'obstacle0');
        this.obstacleSigs.set(obstacle.id, sig);
      }
    }
    // 清理快照中已不存在的障碍物（布局数量变化时）
    for (const [id, view] of this.obstacleViews) {
      if (!snapshot.obstacles.some((obstacle) => obstacle.id === id)) {
        view.destroy();
        this.obstacleViews.delete(id);
        this.obstacleSigs.delete(id);
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
      // 车体朝移动方向，炮管独立朝瞄准方向
      const prevPos = this.previousPositions.get(player.id);
      let bodyAngle = this.bodyAngles.get(player.id) ?? 0;
      if (prevPos && (player.x !== prevPos.x || player.y !== prevPos.y)) {
        bodyAngle = Math.atan2(player.y - prevPos.y, player.x - prevPos.x);
        this.bodyAngles.set(player.id, bodyAngle);
      }
      this.previousPositions.set(player.id, { x: player.x, y: player.y });
      view.body.setPosition(player.x, player.y)
        .setRotation(bodyAngle)
        .setAlpha(player.alive ? 1 : 0.22);
      view.bodyLayer.setRotation(BODY_TEX_OFFSET);
      view.turretLayer.setRotation(player.angle + GUN_TEX_OFFSET - bodyAngle);
      view.name.setPosition(player.x, player.y - 46).setText(player.id === this.playerId ? `${player.name}（你）` : player.name);
      this.drawHealth(view.healthBar, player.x, player.y - 38, player.health);
      const oldHealth = this.previousHealth.get(player.id);
      if (oldHealth !== undefined && oldHealth > player.health) {
        this.showHit(player.x, player.y);
      }
      this.previousHealth.set(player.id, player.health);
    }

    for (const impact of snapshot.impacts) {
      if (this.impactIds.has(impact.id)) continue;
      this.impactIds.add(impact.id);
      this.showHit(impact.x, impact.y);
    }
    if (this.impactIds.size > 256) {
      this.impactIds = new Set(snapshot.impacts.map((impact) => impact.id));
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

    this.onSnapshot(snapshot);
  }

  private createTank(id: string, color: number, name: string): TankView {
    const tankIdx = colorToTankIndex[color] ?? 0;
    const pivot = BODY_PIVOTS[tankIdx]!;
    const car = this.add.image(0, 0, BODY_KEYS[tankIdx]!).setOrigin(0);
    const scale = TANK_TEX_WIDTH / car.width;
    car.setScale(scale);
    car.setPosition(-pivot.x * scale, -pivot.y * scale);
    const turretPivot = GUN_PIVOTS[tankIdx]!;
    const turret = this.add.image(0, 0, GUN_KEYS[tankIdx]!).setOrigin(0);
    turret.setScale(scale);
    turret.setPosition(-turretPivot.x * scale, -turretPivot.y * scale);
    const shadow = this.add.ellipse(3, 5, 44, 30, 0x000000, 0.35);
    const bodyContainer = this.add.container(0, 0, [shadow, car]);
    const turretContainer = this.add.container(0, 0, [turret]);
    const container = this.add.container(0, 0, [bodyContainer, turretContainer]).setName(id);
    const healthBar = this.add.graphics();
    const label = this.add.text(0, 0, name, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#eaf4ff',
      stroke: '#0b1320',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(100);
    return { body: container, bodyLayer: bodyContainer, turretLayer: turretContainer, car, turret, healthBar, name: label };
  }

  private drawHealth(graphics: Phaser.GameObjects.Graphics, x: number, y: number, health: number): void {
    graphics.clear();
    graphics.setDepth(99);
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
