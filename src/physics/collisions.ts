import { Collision, Entity, Segment, Vec2 } from '../types';
import { SpatialHash } from './spatialHash';

function wrappedDelta(from: number, to: number, worldSize: number): number {
  let delta = to - from;
  const half = worldSize * 0.5;
  if (delta > half) delta -= worldSize;
  else if (delta < -half) delta += worldSize;
  return delta;
}

function segmentIntersection(segA: Segment, segB: Segment, offsetX: number, offsetY: number, outPoint: Vec2): boolean {
  if (segA.aabbMaxX < segB.aabbMinX + offsetX || segA.aabbMinX > segB.aabbMaxX + offsetX) return false;
  if (segA.aabbMaxY < segB.aabbMinY + offsetY || segA.aabbMinY > segB.aabbMaxY + offsetY) return false;

  const p1 = segA.worldStart;
  const p2 = segA.worldEnd;
  const p3x = segB.worldStart.x + offsetX;
  const p3y = segB.worldStart.y + offsetY;
  const p4x = segB.worldEnd.x + offsetX;
  const p4y = segB.worldEnd.y + offsetY;

  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4x - p3x;
  const d2y = p4y - p3y;

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) return false;

  const dx = p3x - p1.x;
  const dy = p3y - p1.y;

  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    outPoint.x = p1.x + t * d1x;
    outPoint.y = p1.y + t * d1y;
    return true;
  }

  return false;
}

const checkedSet = new Set<number>();
const collisionBuffer: Collision[] = [];
const intersectionPoint: Vec2 = { x: 0, y: 0 };

export function detectCollisions(entities: Entity[], spatialHash: SpatialHash, worldWidth: number, worldHeight: number): Collision[] {
  let collisionCount = 0;

  spatialHash.clear();
  for (const entity of entities) {
    if (entity.dead) continue;
    spatialHash.insert(entity);
  }

  checkedSet.clear();
  spatialHash.forEachPair(checkedSet, (entityA, entityB) => {
    const centerDx = wrappedDelta(entityA.position.x, entityB.position.x, worldWidth);
    const centerDy = wrappedDelta(entityA.position.y, entityB.position.y, worldHeight);
    const combinedRadius = entityA.boundingRadius + entityB.boundingRadius;
    if (centerDx * centerDx + centerDy * centerDy > combinedRadius * combinedRadius) {
      return;
    }

    const aA = entityA.aabbMin;
    const aB = entityA.aabbMax;
    const bA = entityB.aabbMin;
    const bB = entityB.aabbMax;

    let offsetX = 0;
    let offsetY = 0;
    let aabbOverlaps = false;

    if (aA.x <= bB.x && aB.x >= bA.x && aA.y <= bB.y && aB.y >= bA.y) {
      aabbOverlaps = true;
    } else if (aA.x < 0 && aB.x + worldWidth >= bA.x && aA.y <= bB.y && aB.y >= bA.y) {
      offsetX = -worldWidth;
      aabbOverlaps = true;
    } else if (aB.x > worldWidth && aA.x - worldWidth <= bB.x && aA.y <= bB.y && aB.y >= bA.y) {
      offsetX = worldWidth;
      aabbOverlaps = true;
    } else if (aA.y < 0 && aB.y + worldHeight >= bA.y && aA.x <= bB.x && aB.x >= bA.x) {
      offsetY = -worldHeight;
      aabbOverlaps = true;
    } else if (aB.y > worldHeight && aA.y - worldHeight <= bB.y && aA.x <= bB.x && aB.x >= bA.x) {
      offsetY = worldHeight;
      aabbOverlaps = true;
    }

    if (!aabbOverlaps) return;

    outer: for (const segA of entityA.segments) {
      for (const segB of entityB.segments) {
        if (segmentIntersection(segA, segB, offsetX, offsetY, intersectionPoint)) {
          let collision = collisionBuffer[collisionCount];
          if (!collision) {
            collision = {
              entityA,
              entityB,
              segmentA: segA,
              segmentB: segB,
              point: { x: intersectionPoint.x, y: intersectionPoint.y }
            };
            collisionBuffer.push(collision);
          } else {
            collision.entityA = entityA;
            collision.entityB = entityB;
            collision.segmentA = segA;
            collision.segmentB = segB;
            collision.point.x = intersectionPoint.x;
            collision.point.y = intersectionPoint.y;
          }
          collisionCount++;
          break outer;
        }
      }
    }
  });

  collisionBuffer.length = collisionCount;
  return collisionBuffer;
}
