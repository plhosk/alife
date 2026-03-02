import { SegmentType } from './models';

export const GENOME_LIMITS_CONSTANTS = {
  maxLimbGroups: 2,
  maxTotalLimbs: 6,
  genomeBaseSegmentBudget: 20,
  genomeSymmetrySegmentBonus: 6,
  minSegmentLength: 5,
  maxSegmentLength: 50,
  minPulseIntervalMs: 120,
  maxPulseIntervalMs: 5000,
  defaultNeuralPulseIntervalMs: 600,
  minSegmentsPerGroup: 2,
} as const;

export const GENOME_MUTATION_CONSTANTS = {
  symmetryMutationChance: 0.1,
  phaseModeMutationChance: 0.1,
  phaseSpreadMutationChance: 0.2,
  typeMutationChance: 0.2,
  parentMutationChance: 0.1,
  segmentAddChance: 0.5,
  segmentRemovalChance: 0.5,
  groupAddChance: 0.1,
  groupRemovalChance: 0.15,
  groupSplitChance: 0.05,
  groupMergeChance: 0.05,
  lengthMutationRange: 0.2,
  angleMutationRange: 30,
  pulseIntervalMutationRange: 0.15,
  locomotorDirectionMutationChance: 0.1,
  neuralBehaviorMutationChance: 0.1,
} as const;

export const GENOME_GENERATION_CONSTANTS = {
  secondGroupChance: 0.15,
  generatedMinSegmentLength: GENOME_LIMITS_CONSTANTS.minSegmentLength,
  generatedMaxSegmentLength: 30,
  pulseIntervalModeMs: 600,
} as const;

export const GENOME_PRUNING_CONSTANTS = {
  pruningDepthWeight: 10,
  pruningTypeFrequencyWeight: 3,
} as const;

export const ENTITY_RESOURCE_CONSTANTS = {
  reproLengthScale: 50,
  reproVarianceMin: 0.8,
  reproVarianceRange: 0.4,
  initialFoodRatioMin: 0.4,
  initialFoodRatioRange: 0.2,
  hpWeight: {
    [SegmentType.Armor]: 2,
    [SegmentType.Attack]: 1.5,
    [SegmentType.Photosynth]: 1,
    [SegmentType.Locomotor]: 1,
    [SegmentType.Neural]: 1,
  } as Record<SegmentType, number>,
  foodBufferWeight: {
    [SegmentType.Locomotor]: 2,
    [SegmentType.Photosynth]: 1.5,
    [SegmentType.Armor]: 1,
    [SegmentType.Attack]: 1,
    [SegmentType.Neural]: 1,
  } as Record<SegmentType, number>,
} as const;

export const SURVIVAL_CONSTANTS = {
  starvationThreshold: 0.25,
  healingThreshold: 0.75,
  maxAgeUnlimitedMs: 3600000,
} as const;

export const LINEAGE_CONSTANTS = {
  maxLineageDepth: 3,
} as const;

export const METABOLISM_CONSTANTS = {
  symmetryMetabolismMultiplier: 0.00,
  metabolismWeight: {
    [SegmentType.Armor]: 1.5,
    [SegmentType.Attack]: 1,
    [SegmentType.Photosynth]: 1,
    [SegmentType.Locomotor]: 1,
    [SegmentType.Neural]: 2.5,
  } as Record<SegmentType, number>,
} as const;

export const PHOTOSYNTHESIS_CONSTANTS = {
  lengthScale: 50,
} as const;

export const LOCOMOTION_CONSTANTS = {
  torqueMultiplier: 0.5,
  nutrientDemandImpulseReference: 100,
} as const;

export const NEURAL_CONSTANTS = {
  baseSenseRangePerLength: 3,
  metabolicCostMultiplier: 2.5,
  reverseDirectionEfficiency: 0.3,
  coordinationSolverIterations: 4,
  coordinationLinearWeight: 1.0,
  coordinationAngularWeight: 0.6,
  coordinationTurnLinearTradeoff: 0.5,
  coordinationTurnDemandScale: 0.85,
  coordinationTurnBlendExponent: 1.0,
  coordinationZeroSpeedThreshold: 1.0,
} as const;

export const ENVIRONMENT_FIELD_CONSTANTS = {
  footprintWeightMinThreshold: 0.1,
} as const;

export const ATTACK_CONSTANTS = {
  armorDamageReduction: 0.9,
  attackDamageReduction: 0.6,
  cornerThreshold: 2.0,
} as const;

export const AGGRESSION_HEAT_CONSTANTS = {
  baseGainOnAttack: 0.06,
  damageNormalization: 20,
  foodStealNormalization: 12,
  damageWeight: 0.7,
  foodStealWeight: 0.3,
  maxPhotosynthPenalty: 0.6,
  photosynthPenaltyCurveExponent: 1.6,
} as const;

export const REPRODUCTION_CONSTANTS = {
  spawnSeparationFootprintMultiplier: 4,
  spawnImpulseReferenceFootprintRadius: 24,
  distanceBase: 30,
  distanceIncrement: 10,
  overlapCheckDistance: 20,
  spawnAttempts: 4,
  globalReproductionCooldownMs: 50,
} as const;

export const INITIAL_POPULATION_CONSTANTS = {
  count: 50,
} as const;

export const PHYSICS_CONSTANTS = {
  spatialHashCellSize: 100,
  minPenetrationDepth: 2,
  positionCorrectionFactor: 0.8,
  minVelocity: 1,
  maxVelocity: 200,
  maxAngularVelocity: 3,
} as const;

export const SIMULATION_TIMING_CONSTANTS = {
  standardStepDtSec: 1 / 60,
  automationStepDtSec: 1 / 30,
} as const;

export const PERFORMANCE_CONTROL_CONSTANTS = {
  idealFrameTimeMs: 1000 / 60,
  minSpeedMultiplier: 1,
  maxSpeedMultiplier: 512,
  targetRatio: 0.8,
  calcTimePerFrameHistorySize: 6,
  automationTargetFrameTimeMs: 1000 / 60,
  manualSpeedThrottleFrameTimeMs: 250,
} as const;

export const SEGMENT_COLORS: Record<SegmentType, string> = {
  [SegmentType.Armor]: '#808080',
  [SegmentType.Photosynth]: '#40b82e',
  [SegmentType.Locomotor]: '#1a50f5',
  [SegmentType.Attack]: '#e92819',
  [SegmentType.Neural]: '#e6c200',
};

export const BAR_COLORS = {
  repro: '#4488ff',
  food: '#ffaa22',
  hp: '#22cc44',
} as const;

export const CAMERA_CONSTANTS = {
  zoomMin: 0.1,
  zoomMax: 5,
  gridSize: 100,
  fallbackBorderPaddingPx: 16,
  insetPaddingScale: 0.5,
  borderVisibilityEpsilonPx: 0.5,
  panMaxOffsetRatio: 0.75,
} as const;

export const VISUAL_EFFECTS_CONSTANTS = {
  flashDurationMs: 66,
  showCullingDeathFlash: false,
  exhaustDurationMs: 250,
  exhaustLengthWorld: 8,
} as const;

export const FLASH_COLORS = {
  attackFlashColor: 'rgba(255, 255, 255, 0.7)',
  deathFlashColor: 'rgba(255, 255, 255, 0.7)',
} as const;

export const RENDER_STYLE_CONSTANTS = {
  segmentLineWidth: 2,
  barWidth: 30,
  barHeight: 3,
  barGap: 0,
  barOffsetY: 24,
  previewCanvasSize: 120,
  previewMargin: 8,
  previewMaxScale: 24,
  previewMaxLineWidth: 6,
} as const;

export const INPUT_CONSTANTS = {
  clickSelectionDistance: 50,
  panDeadZone: 5,
} as const;

export const PANEL_CONSTANTS = {
  uiUpdateIntervalMs: 1000,
  incomeHistoryMaxSamples: 180,
  maxRelativesShown: 24,
} as const;

export const ENTITY_NAMING_CONSTANTS = {
  emojiRanges: [
    [0x1F600, 0x1F64F],
    [0x1F300, 0x1F5FF],
    [0x1F680, 0x1F6FF],
    [0x1F900, 0x1F9FF],
    [0x1FA00, 0x1FA6F],
    [0x1FA70, 0x1FAFF],
    [0x2600, 0x26FF],
    [0x2700, 0x27BF],
    [0x1F000, 0x1F02F],
  ] as Array<[number, number]>,
  maxEmojiAttempts: 20,
  fallbackEmoji: '⭐',
} as const;
