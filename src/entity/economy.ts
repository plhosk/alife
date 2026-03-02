import {
  AGGRESSION_HEAT_CONSTANTS,
  Config,
  Entity,
  METABOLISM_CONSTANTS,
  NEURAL_CONSTANTS,
  PHOTOSYNTHESIS_CONSTANTS,
  SegmentType,
  Vec2,
} from '../types';

export function calculateMetabolism(entity: Entity, config: Config): number {
  let cost = 0;

  for (const seg of entity.segments) {
    let multiplier = METABOLISM_CONSTANTS.metabolismWeight[seg.type];
    if (seg.type === SegmentType.Neural) {
      multiplier *= NEURAL_CONSTANTS.metabolicCostMultiplier;
    }
    cost += config.metabolismPerSegment * multiplier;
    cost += seg.length * config.metabolismPerLength * multiplier;
  }

  const symmetryMultiplier = 1 + Math.max(0, entity.symmetryAngles.length - 1) * METABOLISM_CONSTANTS.symmetryMetabolismMultiplier;
  cost *= symmetryMultiplier;

  return cost;
}

export function calculateSegmentLengthByType(entity: Entity, type: SegmentType): number {
  let total = 0;
  for (const seg of entity.segments) {
    if (seg.type === type) {
      total += seg.length;
    }
  }
  return total;
}

export function calculateFoodStealMultiplier(entity: Entity): number {
  const attackLength = calculateSegmentLengthByType(entity, SegmentType.Attack);
  const photosynthLength = calculateSegmentLengthByType(entity, SegmentType.Photosynth);
  if (photosynthLength === 0) return 1;
  const ratio = attackLength / photosynthLength;
  if (ratio <= 1) return 0;
  return (ratio - 1) / ratio;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function calculateEnvironmentPhotosynthesisMultiplier(nutrientLevel: number, config: Config): number {
  const clampedNutrientLevel = clamp01(nutrientLevel);
  const minMultiplier = clamp01(config.environmentNutrientPhotosynthMinMultiplier);
  const maxMultiplier = 1;
  return minMultiplier + (maxMultiplier - minMultiplier) * clampedNutrientLevel;
}

export function calculatePhotosynthesisMultiplier(entity: Entity): number {
  const normalizedHeat = clamp01(entity.aggressionHeat);
  const heatPenalty = AGGRESSION_HEAT_CONSTANTS.maxPhotosynthPenalty
    * Math.pow(normalizedHeat, AGGRESSION_HEAT_CONSTANTS.photosynthPenaltyCurveExponent);
  return clamp01(1 - heatPenalty);
}

export function calculatePhotosynthesis(entity: Entity, config: Config, environmentMultiplier: number = 1): number {
  const multiplier = calculatePhotosynthesisMultiplier(entity);

  let gain = 0;
  for (const seg of entity.segments) {
    if (seg.type === SegmentType.Photosynth) {
      gain += (seg.length / PHOTOSYNTHESIS_CONSTANTS.lengthScale) * config.photosynthesisRate * multiplier * environmentMultiplier;
    }
  }
  return gain;
}

export function transferFoodOverflowToRepro(entity: Entity): void {
  if (entity.foodBuffer > entity.maxFoodBuffer) {
    const excess = entity.foodBuffer - entity.maxFoodBuffer;
    entity.foodBuffer = entity.maxFoodBuffer;
    const reproSpace = entity.reproductiveThreshold - entity.reproductiveBuffer;
    entity.reproductiveBuffer += Math.min(excess, reproSpace);
  }
}

export function canReproduce(entity: Entity): boolean {
  return (
    entity.reproductiveBuffer >= entity.reproductiveThreshold &&
    !entity.dead
  );
}

export function randomPosition(config: Config, randomFn: () => number = Math.random): Vec2 {
  return {
    x: randomFn() * config.worldWidth,
    y: randomFn() * config.worldHeight
  };
}
