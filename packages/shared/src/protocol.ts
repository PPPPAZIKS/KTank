export type GameStatus = 'waiting' | 'playing' | 'finished';

export interface Vector2 {
  x: number;
  y: number;
}

export interface TankState extends Vector2 {
  id: string;
  name: string;
  angle: number;
  health: number;
  alive: boolean;
  connected: boolean;
  color: number;
}

export interface BulletState extends Vector2 {
  id: string;
  ownerId: string;
}

export interface ObstacleState extends Vector2 {
  id: string;
  width: number;
  height: number;
}

export interface GameSnapshot {
  roomId: string;
  status: GameStatus;
  hostId: string | null;
  players: TankState[];
  bullets: BulletState[];
  obstacles: ObstacleState[];
  winnerId: string | null;
  serverTime: number;
}

export interface PlayerInput {
  sequence: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  angle: number;
}

export interface JoinRequest {
  roomId: string;
  name: string;
  sessionId: string;
}

export type JoinResponse =
  | { ok: true; playerId: string; sessionId: string; snapshot: GameSnapshot }
  | { ok: false; message: string };

export interface ClientToServerEvents {
  joinRoom: (request: JoinRequest, callback: (response: JoinResponse) => void) => void;
  playerInput: (input: PlayerInput) => void;
  fire: () => void;
  startGame: () => void;
  restart: () => void;
  leaveRoom: (callback: () => void) => void;
}

export interface ServerToClientEvents {
  snapshot: (snapshot: GameSnapshot) => void;
  notice: (message: string) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  roomId?: string;
  playerId?: string;
  intentionalLeave?: boolean;
}
