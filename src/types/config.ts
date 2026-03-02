import { CullingStrategy, NutrientFieldType } from './models';
import { SURVIVAL_CONSTANTS } from './constants';

export interface Config {
  worldWidth: number;
  worldHeight: number;
  initialRandomSeed: number | null;
  evolutionRandomSeed: number | null;
  maxPopulation: number;
  baseMaxHp: number;
  hpPerWeightedLength: number;
  baseMaxFoodBuffer: number;
  foodBufferPerWeightedLength: number;
  metabolismPerSegment: number;
  metabolismPerLength: number;
  photosynthesisRate: number;
  locomotorImpulsePerLength: number;
  locomotorFoodCost: number;
  impulseNutrientDemandRate: number;
  environmentLocomotorNutrientToFoodScale: number;
  attackDamagePerLength: number;
  foodStealPerDamage: number;
  aggressionHeatStrength: number;
  aggressionHeatRecoverySec: number;
  maxAgeMs: number;
  reproductiveThreshold: number;
  mutationRate: number;
  motionDamping: number;
  collisionFriction: number;
  collisionRestitution: number;
  cullingStrategy: CullingStrategy;
  familyNonAggression: boolean;
  killFoodTransferFraction: number;
  foodDrivenHpRate: number;
  genomeBaseSegmentBudget: number;
  genomeSymmetrySegmentBonus: number;
  genomeMinSegmentsPerGroup: number;
  simulationTimeScale: number;
  environmentCellSize: number;
  environmentNutrientPhotosynthMinMultiplier: number;
  environmentNutrientConsumptionRate: number;
  environmentNutrientRegenRate: number;
  environmentFootprintScale: number;
  environmentFootprintFalloffPower: number;
  nutrientFieldType: NutrientFieldType;
}

export const DEFAULT_CONFIG: Config = {
  worldWidth: 1600,
  worldHeight: 1600,
  initialRandomSeed: null,
  evolutionRandomSeed: null,
  maxPopulation: 750,
  baseMaxHp: 50,
  hpPerWeightedLength: 0.5,
  baseMaxFoodBuffer: 20,
  foodBufferPerWeightedLength: 0.5,
  metabolismPerSegment: 0,
  metabolismPerLength: 0.01,
  photosynthesisRate: 9.6,
  locomotorImpulsePerLength: 54,
  locomotorFoodCost: 0.0029,
  impulseNutrientDemandRate: 0.0088,
  environmentLocomotorNutrientToFoodScale: 8.0,
  attackDamagePerLength: 8.4,
  foodStealPerDamage: 2.1,
  aggressionHeatStrength: 0.5,
  aggressionHeatRecoverySec: 15,
  maxAgeMs: SURVIVAL_CONSTANTS.maxAgeUnlimitedMs,
  reproductiveThreshold: 100,
  mutationRate: 0.15,
  motionDamping: 0.02,
  collisionFriction: 0.10,
  collisionRestitution: 0.9,
  cullingStrategy: 'most-common',
  familyNonAggression: true,
  killFoodTransferFraction: 0.6,
  foodDrivenHpRate: 2.5,
  genomeBaseSegmentBudget: 20,
  genomeSymmetrySegmentBonus: 6,
  genomeMinSegmentsPerGroup: 2,
  simulationTimeScale: 1,
  environmentCellSize: 16,
  environmentNutrientPhotosynthMinMultiplier: 0.81,
  environmentNutrientConsumptionRate: 0.05,
  environmentNutrientRegenRate: 0.3,
  environmentFootprintScale: 2.35,
  environmentFootprintFalloffPower: 2.5,
  nutrientFieldType: 'uniform',
};
