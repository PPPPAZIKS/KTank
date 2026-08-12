import { GAME_HEIGHT, GAME_WIDTH, type GameSnapshot } from '@ktank/shared';
import Phaser from 'phaser';
import { BattleScene } from './game/BattleScene';
import { GameClient, type ConnectionState } from './network';
import './styles.css';

const lobby = document.querySelector<HTMLElement>('#lobby')!;
const arena = document.querySelector<HTMLElement>('#arena')!;
const form = document.querySelector<HTMLFormElement>('#join-form')!;
const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const roomInput = document.querySelector<HTMLInputElement>('#room')!;
const error = document.querySelector<HTMLElement>('#error')!;
const roomLabel = document.querySelector<HTMLElement>('#room-label')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const playerCount = document.querySelector<HTMLElement>('#player-count')!;
const playerList = document.querySelector<HTMLElement>('#player-list')!;
const startGame = document.querySelector<HTMLButtonElement>('#start-game')!;
const leaveRoom = document.querySelector<HTMLButtonElement>('#leave-room')!;
const networkOverlay = document.querySelector<HTMLElement>('#network-overlay')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const result = document.querySelector<HTMLElement>('#result')!;
const resultText = document.querySelector<HTMLElement>('#result-text')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;

const client = new GameClient(import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001');
let playerId = '';
let game: Phaser.Game | undefined;
let scene: BattleScene | undefined;
let latestSnapshot: GameSnapshot | undefined;
let toastTimer: number | undefined;

client.onNotice(showToast);
client.onConnectionChange(renderConnection);
client.connect();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = '连接中…';
  try {
    const response = await client.join(roomInput.value, nameInput.value);
    if (!response.ok) {
      error.textContent = response.message;
      return;
    }
    playerId = response.playerId;
    latestSnapshot = response.snapshot;
    lobby.hidden = true;
    arena.hidden = false;
    roomLabel.textContent = `房间 ${response.snapshot.roomId}`;
    scene = new BattleScene(client, playerId, renderSnapshot);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: '#101824',
      scene
    });
    renderSnapshot(response.snapshot);
    scene.applyInitialSnapshot(response.snapshot);
  } catch {
    error.textContent = '加入房间失败，请检查网络后重试';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '进入战场';
  }
});

startGame.addEventListener('click', () => client.startGame());

restart.addEventListener('click', () => {
  result.hidden = true;
  client.restart();
});

leaveRoom.addEventListener('click', async () => {
  leaveRoom.disabled = true;
  await client.leaveRoom();
  game?.destroy(true);
  game = undefined;
  scene = undefined;
  playerId = '';
  latestSnapshot = undefined;
  document.querySelector('#game')?.replaceChildren();
  arena.hidden = true;
  lobby.hidden = false;
  networkOverlay.hidden = true;
  leaveRoom.disabled = false;
  showToast('已退出房间');
});

function renderSnapshot(snapshot: GameSnapshot): void {
  latestSnapshot = snapshot;
  const isHost = snapshot.hostId === playerId;
  playerCount.textContent = `玩家 ${snapshot.players.length}/4`;
  playerList.replaceChildren(
    ...snapshot.players.map((player) => {
      const item = document.createElement('div');
      item.className = 'player-item';
      const color = document.createElement('span');
      color.className = 'player-color';
      color.style.backgroundColor = `#${player.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('strong');
      const labels = [player.name];
      if (player.id === playerId) labels.push('你');
      if (player.id === snapshot.hostId) labels.push('房主');
      if (!player.connected) labels.push('重连中');
      name.textContent = labels.join(' · ');
      const health = document.createElement('span');
      health.textContent = player.alive ? `生命 ${player.health}` : '已淘汰';
      item.append(color, name, health);
      return item;
    })
  );

  startGame.hidden = snapshot.status !== 'waiting' || !isHost;
  startGame.disabled = snapshot.players.length < 2 || snapshot.players.some((player) => !player.connected);
  restart.hidden = !isHost;

  if (snapshot.status === 'waiting') {
    connection.textContent = snapshot.players.length < 2 ? '等待其他玩家加入' : '等待房主开始';
    result.hidden = true;
    return;
  }
  if (snapshot.status === 'playing') {
    connection.textContent = '对战中';
    result.hidden = true;
    return;
  }
  connection.textContent = '本局结束';
  result.hidden = false;
  if (!snapshot.winnerId) {
    resultText.textContent = '平局';
  } else if (snapshot.winnerId === playerId) {
    resultText.textContent = '你赢了';
  } else {
    const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
    resultText.textContent = `${winner?.name ?? '其他玩家'} 获胜`;
  }
}

function renderConnection(state: ConnectionState): void {
  const inRoom = !arena.hidden;
  if (state === 'connected') {
    networkOverlay.hidden = true;
    if (latestSnapshot) {
      renderSnapshot(latestSnapshot);
    }
    return;
  }
  if (!inRoom) {
    if (state === 'failed') {
      error.textContent = '无法连接服务器，请检查服务是否启动';
    }
    return;
  }
  networkOverlay.hidden = false;
  const title = networkOverlay.querySelector('strong')!;
  const detail = networkOverlay.querySelector('span')!;
  if (state === 'failed') {
    title.textContent = '连接失败';
    detail.textContent = '请检查网络，刷新页面后重试';
  } else {
    title.textContent = '连接已中断';
    detail.textContent = '正在尝试恢复对局…';
  }
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

window.addEventListener('beforeunload', () => {
  game?.destroy(true);
});
