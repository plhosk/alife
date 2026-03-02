import { canReproduce } from '../entity/economy';
import { Genome } from '../genome';
import { checkEntityOverlapFast } from '../physics/overlap';
import { SpatialHash } from '../physics/spatialHash';
import {
  Config,
  Entity,
  PHYSICS_CONSTANTS,
  REPRODUCTION_CONSTANTS,
  SIMULATION_TIMING_CONSTANTS,
  Vec2,
} from '../types';

export interface PendingSpawn {
  genome: string;
  position: Vec2;
  rotation: number;
  parentId?: number;
  parentAncestors?: number[];
  parentGeneration?: number;
  impulseDir: Vec2;
  impulseMagnitude: number;
}

export interface ReproductionStepResult {
  generation: number;
  lastGlobalReproductionSec: number;
}

function clampDamping(value: number): number {
  return Math.min(0.999999, Math.max(0, value));
}

function resolveSpawnImpulseMagnitude(spawnDistance: number, motionDamping: number): number {
  const targetDistance = REPRODUCTION_CONSTANTS.spawnImpulseReferenceFootprintRadius
    * REPRODUCTION_CONSTANTS.spawnSeparationFootprintMultiplier;
  const extraSeparationNeeded = Math.max(0, targetDistance - spawnDistance);
  if (extraSeparationNeeded <= 0) {
    return 0;
  }

  const perEntityDriftDistance = extraSeparationNeeded * 0.5;
  const clampedDamping = clampDamping(motionDamping);
  if (clampedDamping <= 0) {
    return PHYSICS_CONSTANTS.maxVelocity;
  }

  const dampingRatePerSecond = -Math.log1p(-clampedDamping)
    / SIMULATION_TIMING_CONSTANTS.standardStepDtSec;
  const impulse = PHYSICS_CONSTANTS.minVelocity + perEntityDriftDistance * dampingRatePerSecond;
  return Math.max(0, Math.min(PHYSICS_CONSTANTS.maxVelocity, impulse));
}

export function processReproductionStep(
  entities: Entity[],
  config: Config,
  spatialHash: SpatialHash,
  pendingSpawns: PendingSpawn[],
  simulationTimeSec: number,
  lastGlobalReproductionSec: number,
  generation: number,
  randomFn: () => number = Math.random
): ReproductionStepResult {
  let queuedCount = 0;
  let livingCount = 0;
  for (const entity of entities) {
    if (entity.dead) continue;
    livingCount++;
    if (canReproduce(entity)) {
      queuedCount++;
    }
  }
  const queueRatio = livingCount > 0 ? queuedCount / livingCount : 0;
  const baseCooldownSec = REPRODUCTION_CONSTANTS.globalReproductionCooldownMs / 1000;
  const scaledCooldownSec = Math.max(0.001, baseCooldownSec * (1 - queueRatio));

  if (simulationTimeSec - lastGlobalReproductionSec < scaledCooldownSec) {
    return { generation, lastGlobalReproductionSec };
  }

  if (config.cullingStrategy === 'none' && entities.length >= config.maxPopulation) {
    return { generation, lastGlobalReproductionSec };
  }

  const densityThreshold = Math.max(3, Math.floor(config.maxPopulation * 0.05));

  for (const entity of entities) {
    if (canReproduce(entity)) {
      const nearbyCount = spatialHash.countEntitiesInRadius(entity.position, 80, densityThreshold + 1);
      if (nearbyCount > densityThreshold) continue;

      const groups = Genome.mutateGroups(entity.limbGroups, config, randomFn);
      if (groups.length === 0) continue;

      let validSpawn: { position: Vec2; impulseDir: Vec2; impulseMagnitude: number } | null = null;

      for (let attempt = 0; attempt < REPRODUCTION_CONSTANTS.spawnAttempts; attempt++) {
        const angle = randomFn() * Math.PI * 2;
        const distance = REPRODUCTION_CONSTANTS.distanceBase + attempt * REPRODUCTION_CONSTANTS.distanceIncrement;
        const impulseDir = { x: Math.cos(angle), y: Math.sin(angle) };
        const offset = {
          x: entity.position.x + impulseDir.x * distance,
          y: entity.position.y + impulseDir.y * distance
        };

        if (!checkEntityOverlapFast(offset, groups, entities, REPRODUCTION_CONSTANTS.overlapCheckDistance, spatialHash)) {
          const rotation = randomFn() * Math.PI * 2;
          const impulseMagnitude = resolveSpawnImpulseMagnitude(distance, config.motionDamping);
          validSpawn = { position: offset, impulseDir, impulseMagnitude };
          pendingSpawns.push({
            genome: Genome.encodeGroups(groups),
            position: offset,
            rotation,
            parentId: entity.id,
            parentAncestors: entity.ancestorIds,
            parentGeneration: entity.generation,
            impulseDir,
            impulseMagnitude,
          });
          break;
        }
      }

      if (validSpawn) {
        entity.velocity.x -= validSpawn.impulseDir.x * validSpawn.impulseMagnitude;
        entity.velocity.y -= validSpawn.impulseDir.y * validSpawn.impulseMagnitude;
        entity.angularVelocity += (randomFn() - 0.5) * 2;
        entity.reproductiveBuffer = 0;
        return {
          generation: generation + 1,
          lastGlobalReproductionSec: simulationTimeSec,
        };
      }
    }
  }

  return { generation, lastGlobalReproductionSec };
}
