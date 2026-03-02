import { Config, Entity, LOCOMOTION_CONSTANTS, PhaseMode, SegmentType } from '../types';

function computeInitialPulseTime(
  phaseMode: PhaseMode,
  phaseSpread: number,
  symmetryIndex: number,
  symmetryCount: number,
  pulseIntervalMs: number,
  randomFn: () => number
): number {
  if (phaseMode === 'rand') {
    return randomFn() * pulseIntervalMs;
  }

  let phase: number;

  if (phaseMode === 'sync') {
    phase = 0;
  } else {
    phase = (symmetryIndex / Math.max(1, symmetryCount)) * phaseSpread;
  }

  return phase * pulseIntervalMs;
}

export function updateSegmentWorldPositions(entity: Entity, randomFn: () => number = Math.random): void {
  const localPositions = entity.localPositions;
  const expectedLength = localPositions.length;

  if (entity.segments.length !== expectedLength) {
    entity.segments.length = 0;

    for (let groupIndex = 0; groupIndex < entity.limbGroups.length; groupIndex++) {
      const group = entity.limbGroups[groupIndex];
      const symCount = Math.max(1, group.angles.length);

      for (let sym = 0; sym < symCount; sym++) {
        for (let i = 0; i < group.segments.length; i++) {
          const def = group.segments[i];
          entity.segments.push({
            ...def,
            worldStart: { x: 0, y: 0 },
            worldEnd: { x: 0, y: 0 },
            aabbMinX: 0,
            aabbMaxX: 0,
            aabbMinY: 0,
            aabbMaxY: 0,
            nextPulseTimeMs: computeInitialPulseTime(group.phaseMode, group.phaseSpread, sym, symCount, def.pulseIntervalMs, randomFn),
            lastPulseTimeMs: 0,
            lastPulseDirection: 1,
            lastAttackedTimeMs: 0,
            groupIndex
          });
        }
      }
    }
  }

  const cos = Math.cos(entity.rotation);
  const sin = Math.sin(entity.rotation);
  const px = entity.position.x;
  const py = entity.position.y;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < localPositions.length; i++) {
    const local = localPositions[i];
    const seg = entity.segments[i];

    const lsx = local.start.x;
    const lsy = local.start.y;
    const lex = local.end.x;
    const ley = local.end.y;

    seg.worldStart.x = px + cos * lsx - sin * lsy;
    seg.worldStart.y = py + sin * lsx + cos * lsy;
    seg.worldEnd.x = px + cos * lex - sin * ley;
    seg.worldEnd.y = py + sin * lex + cos * ley;

    if (seg.worldStart.x < seg.worldEnd.x) {
      seg.aabbMinX = seg.worldStart.x;
      seg.aabbMaxX = seg.worldEnd.x;
    } else {
      seg.aabbMinX = seg.worldEnd.x;
      seg.aabbMaxX = seg.worldStart.x;
    }
    if (seg.worldStart.y < seg.worldEnd.y) {
      seg.aabbMinY = seg.worldStart.y;
      seg.aabbMaxY = seg.worldEnd.y;
    } else {
      seg.aabbMinY = seg.worldEnd.y;
      seg.aabbMaxY = seg.worldStart.y;
    }

    if (seg.aabbMinX < minX) minX = seg.aabbMinX;
    if (seg.aabbMinY < minY) minY = seg.aabbMinY;
    if (seg.aabbMaxX > maxX) maxX = seg.aabbMaxX;
    if (seg.aabbMaxY > maxY) maxY = seg.aabbMaxY;
  }

  entity.com.x = px + cos * entity.localCom.x - sin * entity.localCom.y;
  entity.com.y = py + sin * entity.localCom.x + cos * entity.localCom.y;

  if (localPositions.length === 0) {
    entity.aabbMin.x = px;
    entity.aabbMin.y = py;
    entity.aabbMax.x = px;
    entity.aabbMax.y = py;
  } else {
    entity.aabbMin.x = minX;
    entity.aabbMin.y = minY;
    entity.aabbMax.x = maxX;
    entity.aabbMax.y = maxY;
  }
}

export function applyLocomotorImpulses(entity: Entity, simDtSec: number, config: Config, currentSimTimeMs: number = 0): number {
  const inverseMass = entity.mass > 0 ? 1 / entity.mass : 0;
  const inverseInertia = entity.inertia > 0 ? 1 / entity.inertia : 0;
  let totalFoodCost = 0;

  for (const seg of entity.segments) {
    if (seg.type !== SegmentType.Locomotor) continue;

    seg.nextPulseTimeMs -= simDtSec * 1000;
    if (seg.nextPulseTimeMs > 0) continue;

    const impulseEnergy = seg.length * config.locomotorImpulsePerLength;

    const dx = seg.worldEnd.x - seg.worldStart.x;
    const dy = seg.worldEnd.y - seg.worldStart.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      seg.nextPulseTimeMs = seg.pulseIntervalMs;
      seg.lastPulseTimeMs = currentSimTimeMs;
      continue;
    }

    const dirX = dx / len;
    const dirY = dy / len;
    const locomotorDirection = seg.locomotorDirection === -1 ? -1 : 1;

    const linearImpulse = impulseEnergy * inverseMass;
    entity.velocity.x += dirX * linearImpulse * locomotorDirection;
    entity.velocity.y += dirY * linearImpulse * locomotorDirection;

    const midX = (seg.worldStart.x + seg.worldEnd.x) / 2;
    const midY = (seg.worldStart.y + seg.worldEnd.y) / 2;
    const armX = midX - entity.com.x;
    const armY = midY - entity.com.y;
    const angularImpulse = (armX * dirY - armY * dirX) * impulseEnergy * LOCOMOTION_CONSTANTS.torqueMultiplier * locomotorDirection;
    entity.angularVelocity += angularImpulse * inverseInertia;

    const foodCost = impulseEnergy * config.locomotorFoodCost;
    entity.foodBuffer = Math.max(0, entity.foodBuffer - foodCost);
    totalFoodCost += foodCost;

    seg.nextPulseTimeMs = seg.pulseIntervalMs;
    seg.lastPulseTimeMs = currentSimTimeMs;
    seg.lastPulseDirection = locomotorDirection;
  }

  return totalFoodCost;
}
