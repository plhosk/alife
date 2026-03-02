import { Entity, LimbGroupDef, Vec2 } from '../types';
import { Genome } from '../genome';
import { SpatialHash } from './spatialHash';

function computeGroupWorldPositions(
  position: Vec2,
  rotation: number,
  groups: LimbGroupDef[]
): Array<{ start: Vec2; end: Vec2 }> | null {
  const segments: Array<{ start: Vec2; end: Vec2 }> = [];

  for (const group of groups) {
    const defs = group.segments;
    const symCount = Math.max(1, group.angles.length);
    const groupStartIdx = segments.length;

    for (let sym = 0; sym < symCount; sym++) {
      const rotationOffset = group.angles[sym] * Math.PI / 180;
      const isMirror = group.mode === 'mirror' && sym % 2 === 1;

      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const angleMultiplier = isMirror ? -1 : 1;

        let worldStart: Vec2;
        let worldEnd: Vec2;

        if (def.parentIndex === -1) {
          worldStart = { ...position };
          const angle = rotation + rotationOffset + def.angle * Math.PI / 180 * angleMultiplier;
          worldEnd = {
            x: position.x + Math.cos(angle) * def.length,
            y: position.y + Math.sin(angle) * def.length
          };
        } else {
          const parentIdx = groupStartIdx + sym * defs.length + def.parentIndex;
          if (parentIdx >= segments.length) return null;
          const parent = segments[parentIdx];
          worldStart = { ...parent.end };
          const parentAngle = Math.atan2(
            parent.end.y - parent.start.y,
            parent.end.x - parent.start.x
          );
          const angle = parentAngle + def.angle * Math.PI / 180 * angleMultiplier;
          worldEnd = {
            x: worldStart.x + Math.cos(angle) * def.length,
            y: worldStart.y + Math.sin(angle) * def.length
          };
        }

        segments.push({ start: worldStart, end: worldEnd });
      }
    }
  }

  return segments;
}

function computeGroupBoundingRadius(groups: LimbGroupDef[]): number {
  const localPositions: Array<{ start: Vec2; end: Vec2 }> = [];

  for (const group of groups) {
    const defs = group.segments;
    const symCount = Math.max(1, group.angles.length);

    for (let sym = 0; sym < symCount; sym++) {
      const rotationOffset = group.angles[sym] * Math.PI / 180;
      const isMirror = group.mode === 'mirror' && sym % 2 === 1;

      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const angleMultiplier = isMirror ? -1 : 1;

        if (def.parentIndex === -1) {
          const start: Vec2 = { x: 0, y: 0 };
          const angle = rotationOffset + def.angle * Math.PI / 180 * angleMultiplier;
          const end: Vec2 = {
            x: Math.cos(angle) * def.length,
            y: Math.sin(angle) * def.length
          };
          localPositions.push({ start, end });
        } else {
          const parentIdx = sym * defs.length + def.parentIndex;
          const parent = localPositions[parentIdx];
          const start: Vec2 = { ...parent.end };
          const parentAngle = Math.atan2(
            parent.end.y - parent.start.y,
            parent.end.x - parent.start.x
          );
          const angle = parentAngle + def.angle * Math.PI / 180 * angleMultiplier;
          const end: Vec2 = {
            x: start.x + Math.cos(angle) * def.length,
            y: start.y + Math.sin(angle) * def.length
          };
          localPositions.push({ start, end });
        }
      }
    }
  }

  let boundingRadius = 0;
  for (const pos of localPositions) {
    const distStart = Math.sqrt(pos.start.x ** 2 + pos.start.y ** 2);
    const distEnd = Math.sqrt(pos.end.x ** 2 + pos.end.y ** 2);
    boundingRadius = Math.max(boundingRadius, distStart, distEnd);
  }

  return boundingRadius;
}

function segmentsAABBOverlap(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const minX1 = Math.min(p1.x, p2.x);
  const maxX1 = Math.max(p1.x, p2.x);
  const minY1 = Math.min(p1.y, p2.y);
  const maxY1 = Math.max(p1.y, p2.y);
  const minX2 = Math.min(p3.x, p4.x);
  const maxX2 = Math.max(p3.x, p4.x);
  const minY2 = Math.min(p3.y, p4.y);
  const maxY2 = Math.max(p3.y, p4.y);
  return maxX1 >= minX2 && minX1 <= maxX2 && maxY1 >= minY2 && minY1 <= maxY2;
}

function lineIntersection(
  p1: Vec2, p2: Vec2,
  p3: Vec2, p4: Vec2
): Vec2 | null {
  if (!segmentsAABBOverlap(p1, p2, p3, p4)) return null;

  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) return null;

  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;

  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y
    };
  }

  return null;
}

export function checkEntityOverlapWithGroups(
  position: Vec2,
  rotation: number,
  groups: LimbGroupDef[],
  entities: Entity[],
  minDistance: number,
  spatialHash?: SpatialHash
): boolean {
  const segments = computeGroupWorldPositions(position, rotation, groups);
  if (!segments) return false;

  let boundingRadiusSq = 0;
  for (const seg of segments) {
    const dsx = seg.start.x - position.x;
    const dsy = seg.start.y - position.y;
    const dex = seg.end.x - position.x;
    const dey = seg.end.y - position.y;
    boundingRadiusSq = Math.max(boundingRadiusSq, dsx * dsx + dsy * dsy, dex * dex + dey * dey);
  }
  const boundingRadius = Math.sqrt(boundingRadiusSq);

  const minDistSq = minDistance * minDistance;
  const searchRadius = minDistance + 100 + boundingRadius;

  const candidates = spatialHash
    ? spatialHash.getEntitiesInRadius(position, searchRadius)
    : entities;

  for (const entity of candidates) {
    if (entity.dead) continue;

    const dx = position.x - entity.position.x;
    const dy = position.y - entity.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) return true;

    const combinedRadius = boundingRadius + entity.boundingRadius;
    if (distSq > combinedRadius * combinedRadius) continue;

    for (const newSeg of segments) {
      for (const existingSeg of entity.segments) {
        const intersection = lineIntersection(
          newSeg.start, newSeg.end,
          existingSeg.worldStart, existingSeg.worldEnd
        );
        if (intersection) return true;
      }
    }
  }

  return false;
}

export function checkEntityOverlap(
  position: Vec2,
  rotation: number,
  genome: string,
  entities: Entity[],
  minDistance: number,
  spatialHash?: SpatialHash
): boolean {
  const groups = Genome.parseGroups(genome);
  if (groups.length === 0) return false;

  return checkEntityOverlapWithGroups(position, rotation, groups, entities, minDistance, spatialHash);
}

export function checkEntityOverlapFast(
  position: Vec2,
  groups: LimbGroupDef[],
  entities: Entity[],
  minDistance: number,
  spatialHash?: SpatialHash
): boolean {
  const boundingRadius = computeGroupBoundingRadius(groups);
  const searchRadius = minDistance + boundingRadius;

  const candidates = spatialHash
    ? spatialHash.getEntitiesInRadius(position, searchRadius)
    : entities;

  for (const entity of candidates) {
    if (entity.dead) continue;

    const dx = position.x - entity.position.x;
    const dy = position.y - entity.position.y;
    const distSq = dx * dx + dy * dy;
    const combinedRadius = minDistance + boundingRadius + entity.boundingRadius;

    if (distSq < combinedRadius * combinedRadius) return true;
  }

  return false;
}
