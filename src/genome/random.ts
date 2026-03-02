import {
  GENOME_GENERATION_CONSTANTS,
  GENOME_LIMITS_CONSTANTS,
  LimbGroupDef,
  LocomotorDirection,
  NEURAL_BEHAVIORS,
  NeuralBehavior,
  PHASE_MODES,
  SEGMENT_TYPES,
  SegmentDef,
  SegmentType,
  SYMMETRY_MODES,
} from '../types';
import { encodeGroups, generateSymmetryAngles } from './codec';
import { getMaxSegmentsForGroup } from './limits';

type RandomFn = () => number;

export function samplePulseIntervalMs(randomFn: RandomFn = Math.random): number {
  const min = GENOME_LIMITS_CONSTANTS.minPulseIntervalMs;
  const max = GENOME_LIMITS_CONSTANTS.maxPulseIntervalMs;
  if (max <= min) return min;

  const mode = Math.min(max, Math.max(min, GENOME_GENERATION_CONSTANTS.pulseIntervalModeMs));
  const spread = max - min;
  const left = mode - min;
  const right = max - mode;
  const pivot = left / spread;
  const u = randomFn();

  if (u <= pivot) {
    return min + Math.sqrt(u * spread * left);
  }
  return max - Math.sqrt((1 - u) * spread * right);
}

export function random(randomFn: RandomFn = Math.random): string {
  return randomBiased(SEGMENT_TYPES, randomFn);
}

export function randomBiased(preferredTypes: SegmentType[], randomFn: RandomFn = Math.random): string {
  const weights = new Map<SegmentType, number>();
  for (const t of preferredTypes) {
    weights.set(t, 1 / preferredTypes.length);
  }
  return randomWeighted(weights, undefined, randomFn);
}

export function randomWeighted(
  weights: Map<SegmentType, number>,
  limits?: { genomeBaseSegmentBudget: number; genomeSymmetrySegmentBonus: number },
  randomFn: RandomFn = Math.random,
  guaranteedType?: SegmentType,
  guaranteedRatio?: number
): string {
  const genomeBaseSegmentBudget = limits?.genomeBaseSegmentBudget ?? GENOME_LIMITS_CONSTANTS.genomeBaseSegmentBudget;
  const genomeSymmetrySegmentBonus = limits?.genomeSymmetrySegmentBonus ?? GENOME_LIMITS_CONSTANTS.genomeSymmetrySegmentBonus;

  const pickWeightedType = (): SegmentType => {
    const total = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    let r = randomFn() * total;
    for (const [type, weight] of weights) {
      r -= weight;
      if (r <= 0) return type;
    }
    return Array.from(weights.keys())[0];
  };

  const randomLocomotorDirection = (type: SegmentType): LocomotorDirection => {
    if (type !== SegmentType.Locomotor && type !== SegmentType.Neural) return 1;
    return randomFn() < 0.5 ? -1 : 1;
  };

  const randomNeuralBehavior = (): NeuralBehavior => {
    return NEURAL_BEHAVIORS[Math.floor(randomFn() * NEURAL_BEHAVIORS.length)];
  };

  const createSegment = (): SegmentDef => ({
    length: GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength + randomFn() * (GENOME_GENERATION_CONSTANTS.generatedMaxSegmentLength - GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength),
    angle: 0,
    type: SegmentType.Armor,
    parentIndex: -1,
    pulseIntervalMs: samplePulseIntervalMs(randomFn),
    locomotorDirection: 1,
    neuralBehavior: 'approach',
  });

  const groups: LimbGroupDef[] = [];
  const firstSymCount = 1 + Math.floor(randomFn() * GENOME_LIMITS_CONSTANTS.maxTotalLimbs);
  const firstGroupSegs = 2 + Math.floor(randomFn() * Math.max(0, getMaxSegmentsForGroup(firstSymCount, firstSymCount, genomeBaseSegmentBudget, genomeSymmetrySegmentBonus) - 3));
  const segmentsByGroup: SegmentDef[][] = [];
  segmentsByGroup.push(Array.from({ length: firstGroupSegs }, createSegment));

  const hasSecondGroup = randomFn() < GENOME_GENERATION_CONSTANTS.secondGroupChance && firstSymCount <= GENOME_LIMITS_CONSTANTS.maxTotalLimbs - 1;
  let secondSymCount = 0;
  if (hasSecondGroup) {
    const remainingLimbs = GENOME_LIMITS_CONSTANTS.maxTotalLimbs - firstSymCount;
    if (remainingLimbs >= 1) {
      secondSymCount = 1 + Math.floor(randomFn() * remainingLimbs);
      const secondGroupSegs = 2 + Math.floor(randomFn() * Math.max(0, getMaxSegmentsForGroup(secondSymCount, firstSymCount + secondSymCount, genomeBaseSegmentBudget, genomeSymmetrySegmentBonus) - 3));
      segmentsByGroup.push(Array.from({ length: secondGroupSegs }, createSegment));
    }
  }

  const totalSegments = segmentsByGroup.reduce((sum, segs) => sum + segs.length, 0);
  const guaranteedCount = (guaranteedType !== undefined && guaranteedRatio !== undefined)
    ? Math.ceil(totalSegments * guaranteedRatio)
    : 0;

  const allIndices: number[] = [];
  for (let i = 0; i < totalSegments; i++) allIndices.push(i);
  for (let i = allIndices.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
  }
  const guaranteedIndices = new Set(allIndices.slice(0, guaranteedCount));

  let globalIdx = 0;
  for (let g = 0; g < segmentsByGroup.length; g++) {
    const segs = segmentsByGroup[g];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      seg.angle = i === 0 ? 0 : randomFn() * 360 - 180;
      seg.parentIndex = i === 0 ? -1 : Math.floor(randomFn() * i);
      const type = guaranteedIndices.has(globalIdx)
        ? guaranteedType!
        : pickWeightedType();
      seg.type = type;
      seg.locomotorDirection = randomLocomotorDirection(type);
      if (type === SegmentType.Neural) {
        seg.neuralBehavior = randomNeuralBehavior();
      }
      globalIdx++;
    }
  }

  groups.push({
    segments: segmentsByGroup[0],
    symmetry: firstSymCount,
    mode: SYMMETRY_MODES[Math.floor(randomFn() * SYMMETRY_MODES.length)],
    angles: generateSymmetryAngles(firstSymCount),
    phaseMode: PHASE_MODES[Math.floor(randomFn() * PHASE_MODES.length)],
    phaseSpread: randomFn(),
    neuralPulseIntervalMs: samplePulseIntervalMs(randomFn)
  });

  if (hasSecondGroup && secondSymCount > 0 && segmentsByGroup[1]) {
    groups.push({
      segments: segmentsByGroup[1],
      symmetry: secondSymCount,
      mode: SYMMETRY_MODES[Math.floor(randomFn() * SYMMETRY_MODES.length)],
      angles: generateSymmetryAngles(secondSymCount),
      phaseMode: PHASE_MODES[Math.floor(randomFn() * PHASE_MODES.length)],
      phaseSpread: randomFn(),
      neuralPulseIntervalMs: samplePulseIntervalMs(randomFn)
    });
  }

  return encodeGroups(groups);
}
