import {
  Config,
  Entity,
  NEURAL_CONSTANTS,
  NeuralBehavior,
  Segment,
  Vec2,
} from '../types';
import { EnvironmentField } from '../environmentField';
import { SpatialHash } from '../physics/spatialHash';
import { areCloseRelatives } from '../simulation/combat';

export interface DetectionResult {
  target: Entity;
  direction: Vec2;
  distance: number;
}

export interface NeuralState {
  combinedDirection: Vec2;
  behavior: NeuralBehavior;
}

export interface NeuralCircle {
  cx: number;
  cy: number;
  r: number;
}

export function getNeuralCircles(neuralSegments: Segment[]): NeuralCircle[] {
  const circles: NeuralCircle[] = [];
  for (const seg of neuralSegments) {
    const dx = seg.worldEnd.x - seg.worldStart.x;
    const dy = seg.worldEnd.y - seg.worldStart.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;
    circles.push({
      cx: seg.worldEnd.x,
      cy: seg.worldEnd.y,
      r: segLen * NEURAL_CONSTANTS.baseSenseRangePerLength,
    });
  }
  return circles;
}

export function maxCircleIntersectionDistance(
  originX: number,
  originY: number,
  circles: NeuralCircle[],
  dirX: number,
  dirY: number
): number {
  let maxDist = 0;
  for (const { cx, cy, r } of circles) {
    const vx = originX - cx;
    const vy = originY - cy;
    const b = vx * dirX + vy * dirY;
    const c = vx * vx + vy * vy - r * r;
    const discriminant = b * b - c;

    if (discriminant >= 0) {
      const sqrtD = Math.sqrt(discriminant);
      const t1 = -b - sqrtD;
      const t2 = -b + sqrtD;
      if (t2 > maxDist) maxDist = t2;
      else if (t1 > maxDist) maxDist = t1;
    }
  }
  return maxDist;
}

function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function wrapDistance(a: Vec2, b: Vec2, worldWidth: number, worldHeight: number): Vec2 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx > worldWidth / 2) dx -= worldWidth;
  if (dx < -worldWidth / 2) dx += worldWidth;
  if (dy > worldHeight / 2) dy -= worldHeight;
  if (dy < -worldHeight / 2) dy += worldHeight;
  return { x: dx, y: dy };
}

export function detectTargets(
  entity: Entity,
  neuralSegments: Segment[],
  spatialHash: SpatialHash,
  config: Config
): DetectionResult | null {
  let bestResult: DetectionResult | null = null;

  for (const neuralSeg of neuralSegments) {
    const maxRange = neuralSeg.length * NEURAL_CONSTANTS.baseSenseRangePerLength;
    const candidates = spatialHash.getEntitiesInRadius(neuralSeg.worldEnd, maxRange);

    for (const candidate of candidates) {
      if (candidate.id === entity.id || candidate.dead) continue;
      if (config.familyNonAggression && areCloseRelatives(entity, candidate)) continue;

      const toTarget = wrapDistance(
        neuralSeg.worldEnd,
        candidate.com,
        config.worldWidth,
        config.worldHeight
      );
      const distance = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y);

      if (distance > maxRange || distance === 0) continue;

      if (!bestResult || distance < bestResult.distance ||
          (distance === bestResult.distance && candidate.id < bestResult.target.id)) {
        bestResult = {
          target: candidate,
          direction: normalize(toTarget),
          distance,
        };
      }
    }
  }

  return bestResult;
}

export function computeNeuralState(
  entity: Entity,
  neuralSegments: Segment[],
  detection: DetectionResult | null,
  environmentField: EnvironmentField
): NeuralState {
  const votes: Record<NeuralBehavior, number> = { approach: 0, flee: 0, forage: 0 };

  for (const seg of neuralSegments) {
    votes[seg.neuralBehavior]++;
  }

  let behavior: NeuralBehavior;
  if (votes.approach >= votes.flee && votes.approach >= votes.forage) {
    behavior = 'approach';
  } else if (votes.flee >= votes.forage) {
    behavior = 'flee';
  } else {
    behavior = 'forage';
  }

  if (behavior === 'forage') {
    const circles = getNeuralCircles(neuralSegments);
    const originX = entity.com.x;
    const originY = entity.com.y;

    const leftDist = maxCircleIntersectionDistance(originX, originY, circles, -1, 0);
    const rightDist = maxCircleIntersectionDistance(originX, originY, circles, 1, 0);
    const upDist = maxCircleIntersectionDistance(originX, originY, circles, 0, -1);
    const downDist = maxCircleIntersectionDistance(originX, originY, circles, 0, 1);

    const left = environmentField.sample('nutrient', originX - leftDist, originY);
    const right = environmentField.sample('nutrient', originX + rightDist, originY);
    const up = environmentField.sample('nutrient', originX, originY - upDist);
    const down = environmentField.sample('nutrient', originX, originY + downDist);

    const dx = right - left;
    const dy = down - up;

    const len = Math.sqrt(dx * dx + dy * dy);
    const gradient: Vec2 = len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };

    return {
      combinedDirection: gradient,
      behavior: 'forage',
    };
  }

  if (!detection) {
    return {
      combinedDirection: { x: 0, y: 0 },
      behavior,
    };
  }

  return {
    combinedDirection: detection.direction,
    behavior,
  };
}
