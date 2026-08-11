import type { ObstacleState, Vector2 } from '@ktank/shared';

export function circlesOverlap(a: Vector2, aRadius: number, b: Vector2, bRadius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radius = aRadius + bRadius;
  return dx * dx + dy * dy <= radius * radius;
}

export function circleHitsRectangle(
  circle: Vector2,
  radius: number,
  rectangle: ObstacleState
): boolean {
  const nearestX = Math.max(rectangle.x, Math.min(circle.x, rectangle.x + rectangle.width));
  const nearestY = Math.max(rectangle.y, Math.min(circle.y, rectangle.y + rectangle.height));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}
