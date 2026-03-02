import { Vec2 } from './types';

export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vecSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vecScale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vecDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vecCross2D(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function vecLength(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vecLengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function vecNormalize(v: Vec2): Vec2 {
  const len = vecLength(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vecNegate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

export function vecDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointToSegmentDist(point: Vec2, segStart: Vec2, segEnd: Vec2): number {
  const seg = vecSub(segEnd, segStart);
  const segLenSq = vecLengthSq(seg);
  if (segLenSq === 0) return vecLength(vecSub(point, segStart));

  let t = vecDot(vecSub(point, segStart), seg) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  const closest = vecAdd(segStart, vecScale(seg, t));
  return vecLength(vecSub(point, closest));
}
