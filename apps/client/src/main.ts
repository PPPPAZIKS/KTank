import { GAME_HEIGHT, GAME_WIDTH, type GameSnapshot } from '@ktank/shared';
import lottie, { type AnimationItem } from 'lottie-web';
import Phaser from 'phaser';
import { BattleScene } from './game/BattleScene';
import { GameClient, type ConnectionState } from './network';
import winDataRaw from './assets/effects/win/data.json';
import winImg0 from './assets/effects/win/images/img_0.png';
import winImg1 from './assets/effects/win/images/img_1.png';
import winImg2 from './assets/effects/win/images/img_2.png';
import winImg3 from './assets/effects/win/images/img_3.png';
import winImg4 from './assets/effects/win/images/img_4.png';
import './styles.css';

// 将 assets 中的图片 URL 注入到 animationData，避免 Vite hash 后路径失效
const winImageMap: Record<string, string> = {
  'img_0.png': winImg0,
  'img_1.png': winImg1,
  'img_2.png': winImg2,
  'img_3.png': winImg3,
  'img_4.png': winImg4,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const winData = JSON.parse(JSON.stringify(winDataRaw)) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const asset of winData.assets as any[]) {
  if (asset.p && winImageMap[asset.p]) {
    asset.u = '';                        // 清空相对路径前缀
    asset.p = winImageMap[asset.p];      // 替换为 Vite 解析后的绝对 URL
    asset.e = 1;                         // 标记为外部 URL（lottie 直接用 src）
  }
}

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
const winLottie = document.querySelector<HTMLElement>('#win-lottie')!;

let winAnim: AnimationItem | null = null;
let winPlayed = false; // 每局只播放一次，重开时重置

const client = new GameClient(import.meta.env.VITE_SERVER_URL as string | undefined);
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
  stopWinAnim();
  winPlayed = false; // 重置标志，下一局可重新播放
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
    stopWinAnim();
  } else if (snapshot.winnerId === playerId) {
    resultText.textContent = '你赢了';
    playWinAnim();
  } else {
    const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
    resultText.textContent = `${winner?.name ?? '其他玩家'} 获胜`;
    stopWinAnim();
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
  stopWinAnim();
});

/** 在 #win-lottie 容器中播放胜利动画（每局只播放一次） */
function playWinAnim(): void {
  if (winPlayed) return; // 已播放过，不再重复
  winPlayed = true;
  winLottie.hidden = false;
  if (winAnim) {
    winAnim.goToAndPlay(0, true);
    return;
  }
  winAnim = lottie.loadAnimation({
    container: winLottie,
    renderer: 'svg',
    loop: false,
    autoplay: true,
    animationData: winData,
  });
}

/** 停止并隐藏胜利动画 */
function stopWinAnim(): void {
  if (winAnim) {
    winAnim.stop();
  }
  winLottie.hidden = true;
}
