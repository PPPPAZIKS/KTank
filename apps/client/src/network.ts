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

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'failed';

interface RoomIdentity {
  roomId: string;
  name: string;
}

export class GameClient {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly sessionId = this.getSessionId();
  private snapshotHandler?: (snapshot: GameSnapshot) => void;
  private noticeHandler?: (message: string) => void;
  private connectionHandler?: (state: ConnectionState) => void;
  private identity?: RoomIdentity;
  private joined = false;
  private reconnecting = false;

  constructor(serverUrl?: string) {
    this.socket = io(resolveServerUrl(serverUrl), {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 5000
    });
    this.socket.on('snapshot', (snapshot) => this.snapshotHandler?.(snapshot));
    this.socket.on('notice', (message) => this.noticeHandler?.(message));
    this.socket.on('connect', () => {
      this.connectionHandler?.('connected');
      if (this.reconnecting && this.identity) {
        void this.resumeRoom();
      }
    });
    this.socket.on('disconnect', () => {
      this.reconnecting = this.joined;
      this.connectionHandler?.(this.joined ? 'reconnecting' : 'disconnected');
    });
    this.socket.io.on('reconnect_attempt', () => this.connectionHandler?.('reconnecting'));
    this.socket.io.on('reconnect_failed', () => this.connectionHandler?.('failed'));
    this.socket.on('connect_error', () => this.connectionHandler?.(this.joined ? 'reconnecting' : 'failed'));
  }

  connect(): void {
    this.socket.connect();
  }

  async join(roomId: string, name: string): Promise<JoinResponse> {
    this.identity = { roomId, name };
    const response = await this.emitJoin(this.identity);
    if (response.ok) {
      this.joined = true;
      this.reconnecting = false;
    } else {
      this.identity = undefined;
    }
    return response;
  }

  onSnapshot(handler: (snapshot: GameSnapshot) => void): void {
    this.snapshotHandler = handler;
  }

  onNotice(handler: (message: string) => void): void {
    this.noticeHandler = handler;
  }

  onConnectionChange(handler: (state: ConnectionState) => void): void {
    this.connectionHandler = handler;
  }

  sendInput(input: PlayerInput): void {
    if (this.socket.connected) {
      this.socket.emit('playerInput', input);
    }
  }

  fire(): void {
    if (this.socket.connected) {
      this.socket.emit('fire');
    }
  }

  startGame(): void {
    this.socket.emit('startGame');
  }

  restart(): void {
    this.socket.emit('restart');
  }

  leaveRoom(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket.connected) {
        this.clearRoom();
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        this.clearRoom();
        resolve();
      }, 3000);
      this.socket.emit('leaveRoom', () => {
        window.clearTimeout(timer);
        this.clearRoom();
        resolve();
      });
    });
  }

  private async resumeRoom(): Promise<void> {
    if (!this.identity) {
      return;
    }
    const response = await this.emitJoin(this.identity);
    if (response.ok) {
      this.reconnecting = false;
      this.snapshotHandler?.(response.snapshot);
      this.noticeHandler?.('已重新连接并恢复对局');
      return;
    }
    this.joined = false;
    this.reconnecting = false;
    this.connectionHandler?.('failed');
    this.noticeHandler?.(`无法恢复对局：${response.message}`);
  }

  private emitJoin(identity: RoomIdentity): Promise<JoinResponse> {
    return new Promise((resolve) => {
      if (!this.socket.connected) {
        resolve({ ok: false, message: '无法连接服务器，请检查网络后重试' });
        return;
      }
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, message: '服务器响应超时，请稍后重试' });
        }
      }, 5000);
      this.socket.emit('joinRoom', { ...identity, sessionId: this.sessionId }, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(response);
      });
    });
  }

  private clearRoom(): void {
    this.joined = false;
    this.reconnecting = false;
    this.identity = undefined;
  }

  private getSessionId(): string {
    const key = 'ktank-session-id';
    const stored = window.sessionStorage.getItem(key);
    if (stored) {
      return stored;
    }
    const generated = typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join('-')}`;
    window.sessionStorage.setItem(key, generated);
    return generated;
  }
}
