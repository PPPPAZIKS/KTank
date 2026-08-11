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
