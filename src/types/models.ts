export enum SegmentType {
  Armor = 'Arm',
  Photosynth = 'Pho',
  Locomotor = 'Loc',
  Attack = 'Att',
  Neural = 'Neu',
}

export type PhaseMode = 'sync' | 'seq' | 'rand';
export type SymmetryMode = 'radial' | 'mirror';
export type CullingStrategy = 'oldest' | 'random' | 'youngest' | 'lowest-hp' | 'lowest-food' | 'most-common' | 'none';
export type NutrientFieldType = 'uniform' | 'center' | 'edges' | 'ring';
export const NUTRIENT_FIELD_TYPES: NutrientFieldType[] = ['uniform', 'center', 'edges', 'ring'];
export const ENVIRONMENT_CHANNELS = ['nutrient'] as const;
export type EnvironmentChannelId = (typeof ENVIRONMENT_CHANNELS)[number];
export const ENVIRONMENT_CHANNEL_BASELINE: Record<EnvironmentChannelId, number> = {
  nutrient: 1,
};

export const SEGMENT_TYPES: SegmentType[] = [SegmentType.Armor, SegmentType.Photosynth, SegmentType.Locomotor, SegmentType.Attack, SegmentType.Neural];
export const PHASE_MODES: PhaseMode[] = ['sync', 'seq', 'rand'];
export const SYMMETRY_MODES: SymmetryMode[] = ['radial', 'mirror'];

export interface Vec2 {
  x: number;
  y: number;
}

export type LocomotorDirection = -1 | 1;

export type NeuralBehavior = 'approach' | 'flee' | 'forage';
export const NEURAL_BEHAVIORS: NeuralBehavior[] = ['approach', 'flee', 'forage'];

export interface SegmentDef {
  length: number;
  angle: number;
  type: SegmentType;
  parentIndex: number;
  pulseIntervalMs: number;
  locomotorDirection: LocomotorDirection;
  neuralBehavior: NeuralBehavior;
}

export interface LimbGroupDef {
  segments: SegmentDef[];
  symmetry: number;
  mode: SymmetryMode;
  angles: number[];
  phaseMode: PhaseMode;
  phaseSpread: number;
  neuralPulseIntervalMs: number;
}

export interface Segment extends SegmentDef {
  worldStart: Vec2;
  worldEnd: Vec2;
  aabbMinX: number;
  aabbMaxX: number;
  aabbMinY: number;
  aabbMaxY: number;
  nextPulseTimeMs: number;
  lastPulseTimeMs: number;
  lastPulseDirection: number;
  lastAttackedTimeMs: number;
  groupIndex: number;
}

export interface Entity {
  id: number;
  name: string | null;
  genome: string;
  limbGroups: LimbGroupDef[];
  segmentDefs: SegmentDef[];
  symmetry: number;
  symmetryMode: SymmetryMode;
  symmetryAngles: number[];
  phaseMode: PhaseMode;
  phaseSpread: number;
  neuralPulseIntervalMs: number;
  nextNeuralPulseTimeMs: number;
  totalLength: number;
  segments: Segment[];
  localPositions: Array<{ start: Vec2; end: Vec2 }>;
  position: Vec2;
  com: Vec2;
  localCom: Vec2;
  rotation: number;
  velocity: Vec2;
  angularVelocity: number;
  hp: number;
  maxHp: number;
  foodBuffer: number;
  maxFoodBuffer: number;
  reproductiveBuffer: number;
  reproductiveThreshold: number;
  ageMs: number;
  dead: boolean;
  deathTimeMs: number;
  mass: number;
  inertia: number;
  aabbMin: Vec2;
  aabbMax: Vec2;
  boundingRadius: number;
  generation: number;
  ancestorIds: number[];
  aggressionHeat: number;
  lastNeuralTargetId: number | null;
  lastNeuralTargetTimeMs: number;
  lastNeuralBehavior: NeuralBehavior | null;
  lastNeuralDirection: Vec2;
}

export interface Collision {
  entityA: Entity;
  entityB: Entity;
  segmentA: Segment;
  segmentB: Segment;
  point: Vec2;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface FoodIncomeBreakdown {
  photosynthesis: number;
  locomotion: number;
  attack: number;
  metabolismDemand: number;
  locomotionDemand: number;
  photosynthNutrientConsumed: number;
  locomotionNutrientConsumed: number;
}

export interface SpawnConfig {
  name: string;
  weights: Map<SegmentType, number>;
  guaranteedType?: SegmentType;
  guaranteedRatio?: number;
}
