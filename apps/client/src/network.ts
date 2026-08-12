import type {
  ClientToServerEvents,
  GameSnapshot,
  JoinResponse,
  PlayerInput,
  ServerToClientEvents
} from '@ktank/shared';
import { io, type Socket } from 'socket.io-client';

function resolveServerUrl(serverUrl?: string): string {
  if (serverUrl) return serverUrl;
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  // 静态托管时自动指向同主机服务端，避免 IP 变更导致失效
  return `${location.protocol}//${location.hostname}:3001`;
}

export class GameClient {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private snapshotHandler?: (snapshot: GameSnapshot) => void;

  constructor(serverUrl?: string) {
    this.socket = io(resolveServerUrl(serverUrl), { autoConnect: false });
    this.socket.on('snapshot', (snapshot) => this.snapshotHandler?.(snapshot));
  }

  connect(): void {
    this.socket.connect();
  }

  join(roomId: string, name: string): Promise<JoinResponse> {
    return new Promise((resolve) => {
      this.socket.emit('joinRoom', { roomId, name }, resolve);
    });
  }

  onSnapshot(handler: (snapshot: GameSnapshot) => void): void {
    this.snapshotHandler = handler;
  }

  sendInput(input: PlayerInput): void {
    this.socket.emit('playerInput', input);
  }

  fire(): void {
    this.socket.emit('fire');
  }

  startGame(): void {
    this.socket.emit('startGame');
  }

  restart(): void {
    this.socket.emit('restart');
  }
}
