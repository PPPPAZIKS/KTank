export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;
export const TANK_RADIUS = 18;
export const TANK_SPEED = 180;
export const BULLET_RADIUS = 5;
export const BULLET_SPEED = 420;
export const FIRE_COOLDOWN_MS = 450;
export const PLAYER_MAX_HEALTH = 3;
export const SERVER_TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const MAX_PLAYERS = 4;

export const OBSTACLES = [
  { id: 'center-wall', x: 430, y: 260, width: 100, height: 120 }
] as const;

export const OBSTACLE_CELL = 64;

/**
 * 服务端权威：用随机 Prim 迷宫算法生成障碍物。
 * 从全墙地图随机挖出连通通道，剩余墙体天然连续成片（无孤立散块），
 * 再保证四个出生点与通道连通。每局布局都不同且无需模板。
 */
export function generateObstacles(
  spawnPoints: { x: number; y: number }[],
  rng: () => number = Math.random
): { id: string; x: number; y: number; width: number; height: number; type: number }[] {
  const cell = OBSTACLE_CELL;
  const cols = Math.floor(GAME_WIDTH / cell);
  const rows = Math.floor(GAME_HEIGHT / cell);
  const idx = (r: number, c: number): number => r * cols + c;
  const inBounds = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols;

  // 全格为墙，逐步挖通道
  const open = new Set<number>();
  const addOpen = (r: number, c: number): void => {
    open.add(idx(r, c));
  };

  // 随机 Prim：以间隔 2 的棋盘格为房间，挖出单格宽通道
  const frontier: [number, number][] = [];
  const inFrontier = new Set<number>();
  const pushFrontier = (r: number, c: number): void => {
    for (const [dr, dc] of [
      [0, 2],
      [0, -2],
      [2, 0],
      [-2, 0]
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && !open.has(idx(nr, nc)) && !inFrontier.has(idx(nr, nc))) {
        inFrontier.add(idx(nr, nc));
        frontier.push([nr, nc]);
      }
    }
  };

  const start = Math.floor(rng() * (rows / 2));
  addOpen(start * 2 + 1, 1);
  pushFrontier(start * 2 + 1, 1);

  while (frontier.length > 0) {
    const fi = Math.floor(rng() * frontier.length);
    const [r, c] = frontier[fi]!;
    frontier.splice(fi, 1);
    inFrontier.delete(idx(r, c));

    const neighbors: [number, number][] = [];
    for (const [dr, dc] of [
      [0, 2],
      [0, -2],
      [2, 0],
      [-2, 0]
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && open.has(idx(nr, nc))) {
        neighbors.push([nr, nc]);
      }
    }
    if (neighbors.length === 0) continue;

    const [nr, nc] = neighbors[Math.floor(rng() * neighbors.length)]!;
    addOpen((r + nr) / 2, (c + nc) / 2); // 打通中间墙
    addOpen(r, c);
    pushFrontier(r, c);
  }

  // 保证出生点连通：把出生格与最近的通道打通
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0]
  ] as const;
  for (const sp of spawnPoints) {
    const sr = Math.floor(sp.y / cell);
    const sc = Math.floor(sp.x / cell);
    if (open.has(idx(sr, sc))) continue;

    // BFS 在墙格上找最近已开放格，沿路径打通
    const queue: [number, number][] = [[sr, sc]];
    const visited = new Set<number>([idx(sr, sc)]);
    const parent = new Map<number, [number, number]>();
    let found: [number, number] | null = null;

    while (queue.length > 0 && !found) {
      const [r, c] = queue.shift()!;
      let exitNow = false;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const key = idx(nr, nc);
        if (open.has(key)) {
          found = [r, c];
          parent.set(key, [r, c]);
          exitNow = true;
          break;
        }
        if (!visited.has(key)) {
          visited.add(key);
          parent.set(key, [r, c]);
          queue.push([nr, nc]);
        }
      }
      if (exitNow) break;
    }

    // 沿路径打通到出生格
    let [r, c] = found ?? [sr, sc];
    addOpen(r, c);
    while (r !== sr || c !== sc) {
      const prev = parent.get(idx(r, c));
      if (!prev) break;
      [r, c] = prev;
      addOpen(r, c);
    }
    addOpen(sr, sc);
  }

  // 剩余格 = 障碍物（迷宫墙体）
  const obstacles: { id: string; x: number; y: number; width: number; height: number; type: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (open.has(idx(r, c))) continue;
      obstacles.push({
        id: `obstacle-${obstacles.length}`,
        x: c * cell,
        y: r * cell,
        width: cell,
        height: cell,
        type: Math.floor(rng() * 2)
      });
    }
  }

  return obstacles;
}
