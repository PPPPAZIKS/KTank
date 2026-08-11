import type { JoinRequest, PlayerInput } from '@ktank/shared';

const ROOM_PATTERN = /^[A-Z0-9]{3,12}$/;

export function normalizeJoinRequest(value: JoinRequest): JoinRequest | null {
  const roomId = typeof value?.roomId === 'string' ? value.roomId.trim().toUpperCase() : '';
  const name = typeof value?.name === 'string' ? value.name.trim().slice(0, 16) : '';
  if (!ROOM_PATTERN.test(roomId) || name.length < 1) {
    return null;
  }
  return { roomId, name };
}

export function normalizeInput(value: PlayerInput): PlayerInput | null {
  if (!value || !Number.isFinite(value.sequence) || !Number.isFinite(value.angle)) {
    return null;
  }
  return {
    sequence: Math.max(0, Math.floor(value.sequence)),
    up: value.up === true,
    down: value.down === true,
    left: value.left === true,
    right: value.right === true,
    angle: Math.atan2(Math.sin(value.angle), Math.cos(value.angle))
  };
}
