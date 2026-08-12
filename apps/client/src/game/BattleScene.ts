import {
  GAME_HEIGHT,
  GAME_WIDTH,
  PLAYER_MAX_HEALTH,
  TANK_RADIUS,
  type GameSnapshot,
  type PlayerInput
} from '@ktank/shared';
import Phaser from 'phaser';
import type { GameClient } from '../network';
import tank0Url from '../assets/tanks/tank-0.png';
import tank1Url from '../assets/tanks/tank-1.png';
import tank2Url from '../assets/tanks/tank-2.png';
import tank3Url from '../assets/tanks/tank-3.png';
import boomUrl from '../assets/effects/boom_4*4.png';

/**
 * 解析命名格式 "xxx_RxC.ext"（如 boom_4*4.png）中的行列数。
 * 取文件名最后一个 _ 之后的部分，支持 * / x / × 作为分隔符。
 * 格式约定：行数在前，列数在后，例如 4*4 → rows=4, cols=4。
 */
function parseGridFromFilename(url: string): { cols: number; rows: number } {
  const filename = url.split('/').pop()!.replace(/\.[^.]+$/, '');
  const segment = filename.split('_').pop() ?? '1x1';
  const parts = segment.split(/[*x×]/i);
  const rows = parseInt(parts[0] ?? '1', 10);
  const cols = parseInt(parts[1] ?? parts[0] ?? '1', 10);
  return { cols, rows };
}

// 服务器按槽位分配的颜色 → 对应素材编号
const colorToTankIndex: Record<number, number> = {
  0x45a3ff: 0, // 蓝
  0xff5f6d: 1, // 红
  0x4fd18b: 2, // 绿
  0xffc857: 3  // 黄
};

// 素材默认炮口朝下（屏幕 +y），逻辑 angle=0 表示炮口朝右 → 逆时针转 90°
const TANK_TEX_ROTATION_OFFSET = -Math.PI / 2;
// 贴合物理碰撞半径 TANK_RADIUS=18，渲染宽度取直径 36
const TANK_TEX_WIDTH = TANK_RADIUS * 2;

// 激光束长度和宽度
const LASER_LENGTH = 30;
const LASER_OUTER_WIDTH = 7;
const LASER_INNER_WIDTH = 3;

interface TankView {
  body: Phaser.GameObjects.Container;
  healthBar: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
}

interface BulletView {
  laser: Phaser.GameObjects.Graphics;
  color: number;
  prevX: number;
  prevY: number;
  /** 方向是否已确定（至少有两帧位置） */
  hasDirX: number;
  hasDirY: number;
}

export class BattleScene extends Phaser.Scene {
  private readonly tanks = new Map<string, TankView>();
  private readonly bullets = new Map<string, BulletView>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right' | 'fire', Phaser.Input.Keyboard.Key>;
  private latestSnapshot?: GameSnapshot;
  private previousHealth = new Map<string, number>();
  private previousAlive = new Map<string, boolean>();
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
    this.load.image('tank0', tank0Url);
    this.load.image('tank1', tank1Url);
    this.load.image('tank2', tank2Url);
    this.load.image('tank3', tank3Url);
    // 先以普通图片加载，create() 中再切割帧
    this.load.image('boom', boomUrl);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x101824);
    this.drawGrid();
    // 解析 boom 图集并注册序列帧动画
    this.setupFrameAnimation('boom', boomUrl, { frameRate: 14, scale: 0.5 });
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
      view.body.setPosition(player.x, player.y)
        .setRotation(player.angle + TANK_TEX_ROTATION_OFFSET)
        .setAlpha(player.alive ? 1 : 0.22);
      view.name.setPosition(player.x, player.y - 39).setText(player.id === this.playerId ? `${player.name}（你）` : player.name);
      this.drawHealth(view.healthBar, player.x, player.y - 28, player.health);
      const oldHealth = this.previousHealth.get(player.id);
      if (oldHealth !== undefined && oldHealth > player.health) {
        this.showHit(player.x, player.y);
      }
      this.previousHealth.set(player.id, player.health);

      // 检测死亡（alive: true → false）时播放爆炸动画
      const wasAlive = this.previousAlive.get(player.id);
      if (wasAlive === true && !player.alive) {
        this.playBoomAt(player.x, player.y);
      }
      this.previousAlive.set(player.id, player.alive);
    }

    // 建立 ownerId → 颜色 快速查找表
    const ownerColor = new Map<string, number>();
    for (const player of snapshot.players) {
      ownerColor.set(player.id, player.color);
    }

    const bulletIds = new Set(snapshot.bullets.map((bullet) => bullet.id));
    for (const [id, view] of this.bullets) {
      if (!bulletIds.has(id)) {
        view.laser.destroy();
        this.bullets.delete(id);
      }
    }

    for (const bullet of snapshot.bullets) {
      const color = ownerColor.get(bullet.ownerId) ?? 0xffffff;
      let view = this.bullets.get(bullet.id);

      if (!view) {
        const laser = this.add.graphics();
        // 用发射者的炮管朝向作为初始方向
        const owner = snapshot.players.find((p) => p.id === bullet.ownerId);
        const initAngle = owner?.angle ?? 0;
        view = {
          laser,
          color,
          prevX: bullet.x - Math.cos(initAngle),
          prevY: bullet.y - Math.sin(initAngle),
          hasDirX: Math.cos(initAngle),
          hasDirY: Math.sin(initAngle)
        };
        this.bullets.set(bullet.id, view);
      }

      // 用当前帧与上一帧位置差分计算方向
      const dx = bullet.x - view.prevX;
      const dy = bullet.y - view.prevY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.5) {
        view.hasDirX = dx / len;
        view.hasDirY = dy / len;
      }

      view.prevX = bullet.x;
      view.prevY = bullet.y;

      this.drawLaser(view.laser, bullet.x, bullet.y, view.hasDirX, view.hasDirY, color);
    }

    this.onSnapshot(snapshot);
  }

  /**
   * 在 (x, y) 位置沿方向 (ux, uy) 绘制短激光束。
   * 弹头在前端，向后延伸 LASER_LENGTH 像素。
   * 两层：外光晕（坦克颜色半透明宽线）+ 内芯（亮白细线）。
   */
  private drawLaser(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    ux: number,
    uy: number,
    color: number
  ): void {
    g.clear();
    const tailX = x - ux * LASER_LENGTH;
    const tailY = y - uy * LASER_LENGTH;

    // 外光晕层：坦克颜色，深色
    g.lineStyle(LASER_OUTER_WIDTH, color, 0.85);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(tailX, tailY);
    g.strokePath();

    // 内芯层：亮白，高不透明
    g.lineStyle(LASER_INNER_WIDTH, 0xffffff, 0.95);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(tailX, tailY);
    g.strokePath();
  }

  private createTank(id: string, color: number, name: string): TankView {
    const tankIdx = colorToTankIndex[color] ?? 0;
    const sprite = this.add.image(0, 0, `tank${tankIdx}`).setOrigin(0.5);
    sprite.setScale(TANK_TEX_WIDTH / sprite.width);
    const shadow = this.add.ellipse(3, 5, 44, 30, 0x000000, 0.35);
    const container = this.add.container(0, 0, [shadow, sprite]).setName(id);
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

  /**
   * 将已加载的普通纹理按命名约定切割为序列帧，并注册动画。
   * @param key     纹理 key（需已在 preload 中 load.image）
   * @param url     原始 URL（用于从文件名解析行列数）
   * @param options 动画选项：帧率、缩放
   */
  private setupFrameAnimation(
    key: string,
    url: string,
    options: { frameRate?: number; scale?: number } = {}
  ): void {
    const { cols, rows } = parseGridFromFilename(url);
    const tex = this.textures.get(key);
    const totalW = tex.source[0]!.width;
    const totalH = tex.source[0]!.height;
    const frameW = Math.floor(totalW / cols);
    const frameH = Math.floor(totalH / rows);

    // 手动向纹理添加数字索引帧
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tex.add(idx++, 0, c * frameW, r * frameH, frameW, frameH);
      }
    }

    this.anims.create({
      key,
      frames: Array.from({ length: rows * cols }, (_, i) => ({ key, frame: i })),
      frameRate: options.frameRate ?? 12,
      repeat: 0
    });

    // 保存缩放比供 playBoomAt 使用
    if (options.scale !== undefined) {
      this.registry.set(`${key}_scale`, options.scale);
    }
  }

  /**
   * 在指定位置播放一次爆炸序列帧动画，播放完毕后自动销毁。
   */
  private playBoomAt(x: number, y: number): void {
    const scale = (this.registry.get('boom_scale') as number | undefined) ?? 1;
    const sprite = this.add.sprite(x, y, 'boom', 0);
    sprite.setScale(scale);
    sprite.play('boom');
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
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
