import { GAME_HEIGHT, GAME_WIDTH, type GameSnapshot } from '@ktank/shared';
import Phaser from 'phaser';
import { BattleScene } from './game/BattleScene';
import { GameClient } from './network';
import './styles.css';

const lobby = document.querySelector<HTMLElement>('#lobby')!;
const arena = document.querySelector<HTMLElement>('#arena')!;
const form = document.querySelector<HTMLFormElement>('#join-form')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const roomInput = document.querySelector<HTMLInputElement>('#room')!;
const error = document.querySelector<HTMLElement>('#error')!;
const roomLabel = document.querySelector<HTMLElement>('#room-label')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const result = document.querySelector<HTMLElement>('#result')!;
const resultText = document.querySelector<HTMLElement>('#result-text')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;

const client = new GameClient(import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001');
let playerId = '';
let game: Phaser.Game | undefined;
let scene: BattleScene | undefined;
let initialSnapshot: GameSnapshot | undefined;

client.connect();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const response = await client.join(roomInput.value, nameInput.value);
  if (!response.ok) {
    error.textContent = response.message;
    return;
  }
  playerId = response.playerId;
  initialSnapshot = response.snapshot;
  lobby.hidden = true;
  arena.hidden = false;
  roomLabel.textContent = `房间 ${response.snapshot.roomId}`;
  connection.textContent = response.snapshot.status === 'waiting' ? '等待对手加入' : '对战中';
  scene = new BattleScene(client, playerId, showResult);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#101824',
    scene
  });
  scene.applyInitialSnapshot(initialSnapshot);
});

restart.addEventListener('click', () => {
  result.hidden = true;
  client.restart();
});

function showResult(winnerId: string | null): void {
  if (!winnerId) {
    result.hidden = true;
    connection.textContent = '对战中';
    return;
  }
  result.hidden = false;
  resultText.textContent = winnerId === playerId ? '你赢了' : '你被淘汰了';
  connection.textContent = '本局结束';
}

window.addEventListener('beforeunload', () => {
  game?.destroy(true);
});
