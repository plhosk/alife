import {
  Config,
  GENOME_GENERATION_CONSTANTS,
  GENOME_LIMITS_CONSTANTS,
  GENOME_MUTATION_CONSTANTS,
  GENOME_PRUNING_CONSTANTS,
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
import { encodeGroups, generateSymmetryAngles, GenomeMetadata, parseGroups } from './codec';
import { getMaxSegmentsForGroup, getTotalLimbs } from './limits';
import { samplePulseIntervalMs } from './random';

type RandomFn = () => number;

function rebuildSegmentsWithRemoval(segments: SegmentDef[], indicesToRemove: Set<number>): SegmentDef[] {
  const indexMap = new Map<number, number>();
  const result: SegmentDef[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (!indicesToRemove.has(i)) {
      indexMap.set(i, result.length);
      result.push({ ...segments[i] });
    }
  }

  for (const seg of result) {
    if (seg.parentIndex >= 0) {
      const newIndex = indexMap.get(seg.parentIndex);
      seg.parentIndex = newIndex !== undefined ? newIndex : -1;
    }
  }

  return result;
}

function pruneSegmentsToLimit(segments: SegmentDef[], maxCount: number): SegmentDef[] {
  if (segments.length <= maxCount) return segments;

  const childCount = new Map<number, number>();
  for (const seg of segments) {
    if (seg.parentIndex >= 0) {
      childCount.set(seg.parentIndex, (childCount.get(seg.parentIndex) ?? 0) + 1);
    }
  }

  const typeCounts = new Map<SegmentType, number>();
  for (const seg of segments) {
    typeCounts.set(seg.type, (typeCounts.get(seg.type) ?? 0) + 1);
  }

  const getDepth = (idx: number): number => {
    const seg = segments[idx];
    if (seg.parentIndex < 0) return 0;
    return 1 + getDepth(seg.parentIndex);
  };

  const removable: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].parentIndex >= 0 && !childCount.has(i)) {
      const depth = getDepth(i);
      const typeFreq = typeCounts.get(segments[i].type) ?? 0;
      const score = depth * GENOME_PRUNING_CONSTANTS.pruningDepthWeight - typeFreq * GENOME_PRUNING_CONSTANTS.pruningTypeFrequencyWeight;
      removable.push({ index: i, score });
    }
  }

  removable.sort((a, b) => b.score - a.score);

  const toRemoveCount = segments.length - maxCount;
  const indicesToRemove = new Set(removable.slice(0, toRemoveCount).map(r => r.index));

  return rebuildSegmentsWithRemoval(segments, indicesToRemove);
}

function randomLocomotorDirection(type: SegmentType, randomFn: RandomFn): LocomotorDirection {
  if (type !== SegmentType.Locomotor && type !== SegmentType.Neural) return 1;
  return randomFn() < 0.5 ? -1 : 1;
}

function randomNeuralBehavior(randomFn: RandomFn): NeuralBehavior {
  return NEURAL_BEHAVIORS[Math.floor(randomFn() * NEURAL_BEHAVIORS.length)];
}

function pickRandomSegmentType(randomFn: RandomFn, enabledTypes?: SegmentType[]): SegmentType {
  const types = enabledTypes && enabledTypes.length > 0 ? enabledTypes : SEGMENT_TYPES;
  return types[Math.floor(randomFn() * types.length)];
}

export function mutateGroups(groups: LimbGroupDef[], config: Config, randomFn: RandomFn = Math.random, enabledSegmentTypes?: SegmentType[]): LimbGroupDef[] {
  if (groups.length === 0) return groups;

  const result = groups.map(g => ({ ...g, segments: [...g.segments] }));
  let totalLimbs = getTotalLimbs(result);
  const minSegments = config.genomeMinSegmentsPerGroup;

  for (let gi = 0; gi < result.length; gi++) {
    const group = result[gi];
    const meta: GenomeMetadata = {
      symmetry: group.symmetry,
      mode: group.mode,
      angles: [...group.angles],
      phaseMode: group.phaseMode,
      phaseSpread: group.phaseSpread,
      neuralPulseIntervalMs: group.neuralPulseIntervalMs
    };

    if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.symmetryMutationChance) {
      const maxNewSym = Math.min(GENOME_LIMITS_CONSTANTS.maxTotalLimbs, GENOME_LIMITS_CONSTANTS.maxTotalLimbs - (totalLimbs - group.symmetry));
      if (maxNewSym >= 1) {
        const newSym = 1 + Math.floor(randomFn() * maxNewSym);
        meta.symmetry = newSym;
        meta.angles = generateSymmetryAngles(newSym);
      }
    }

    if (randomFn() < config.mutationRate * 0.15) {
      meta.mode = SYMMETRY_MODES[Math.floor(randomFn() * SYMMETRY_MODES.length)];
    }

    if (randomFn() < config.mutationRate * 0.2 && meta.angles.length > 0) {
      const idx = Math.floor(randomFn() * meta.angles.length);
      const delta = (randomFn() * 2 - 1) * 30;
      meta.angles[idx] = meta.angles[idx] + delta;
    }

    if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.phaseModeMutationChance) {
      meta.phaseMode = PHASE_MODES[Math.floor(randomFn() * PHASE_MODES.length)];
    }

    if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.phaseSpreadMutationChance) {
      meta.phaseSpread = Math.max(0, Math.min(1, meta.phaseSpread + (randomFn() * 2 - 1) * 0.3));
    }

    if (randomFn() < config.mutationRate) {
      const delta = meta.neuralPulseIntervalMs * GENOME_MUTATION_CONSTANTS.pulseIntervalMutationRange * (randomFn() * 2 - 1);
      meta.neuralPulseIntervalMs = Math.max(GENOME_LIMITS_CONSTANTS.minPulseIntervalMs, Math.min(GENOME_LIMITS_CONSTANTS.maxPulseIntervalMs, meta.neuralPulseIntervalMs + delta));
    }

    meta.symmetry = meta.angles.length;
    totalLimbs = getTotalLimbs(result);

    const maxSegs = getMaxSegmentsForGroup(
      meta.symmetry,
      totalLimbs,
      config.genomeBaseSegmentBudget,
      config.genomeSymmetrySegmentBonus
    );
    const baseSegments = pruneSegmentsToLimit(group.segments, maxSegs);
    const mutated: SegmentDef[] = [];

    for (let i = 0; i < baseSegments.length; i++) {
      const seg = { ...baseSegments[i] };
      const wasLocomotor = seg.type === SegmentType.Locomotor;

      if (randomFn() < config.mutationRate) {
        const delta = seg.length * GENOME_MUTATION_CONSTANTS.lengthMutationRange * (randomFn() * 2 - 1);
        seg.length = Math.max(GENOME_LIMITS_CONSTANTS.minSegmentLength, Math.min(GENOME_LIMITS_CONSTANTS.maxSegmentLength, seg.length + delta));
      }

      if (randomFn() < config.mutationRate) {
        const delta = GENOME_MUTATION_CONSTANTS.angleMutationRange * (randomFn() * 2 - 1);
        seg.angle = seg.angle + delta;
      }

      if (randomFn() < config.mutationRate) {
        const delta = seg.pulseIntervalMs * GENOME_MUTATION_CONSTANTS.pulseIntervalMutationRange * (randomFn() * 2 - 1);
        seg.pulseIntervalMs = Math.max(GENOME_LIMITS_CONSTANTS.minPulseIntervalMs, Math.min(GENOME_LIMITS_CONSTANTS.maxPulseIntervalMs, seg.pulseIntervalMs + delta));
      }

      if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.typeMutationChance) {
        seg.type = pickRandomSegmentType(randomFn, enabledSegmentTypes);
      }

      const usesDirection = seg.type === SegmentType.Locomotor || seg.type === SegmentType.Neural;
      const wasDirectional = wasLocomotor;
      const wasNeural = baseSegments[i].type === SegmentType.Neural;
      
      if (!usesDirection) {
        seg.locomotorDirection = 1;
      } else {
        if (!wasDirectional) {
          seg.locomotorDirection = randomLocomotorDirection(seg.type, randomFn);
        }
        if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.locomotorDirectionMutationChance) {
          seg.locomotorDirection = seg.locomotorDirection === 1 ? -1 : 1;
        }
      }

      if (seg.type === SegmentType.Neural) {
        if (!wasNeural) {
          seg.neuralBehavior = randomNeuralBehavior(randomFn);
        }
        if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.neuralBehaviorMutationChance) {
          seg.neuralBehavior = NEURAL_BEHAVIORS[(NEURAL_BEHAVIORS.indexOf(seg.neuralBehavior) + 1 + Math.floor(randomFn() * 2)) % NEURAL_BEHAVIORS.length];
        }
      }

      if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.parentMutationChance && seg.parentIndex >= 0) {
        seg.parentIndex = Math.floor(randomFn() * i);
      }

      mutated.push(seg);
    }

    if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.segmentAddChance && mutated.length < maxSegs) {
      const parentIndex = Math.floor(randomFn() * mutated.length);
      const segmentType = pickRandomSegmentType(randomFn, enabledSegmentTypes);
      const newSegment: SegmentDef = {
        length: GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength + randomFn() * (GENOME_GENERATION_CONSTANTS.generatedMaxSegmentLength - GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength),
        angle: randomFn() * 360 - 180,
        type: segmentType,
        parentIndex,
        pulseIntervalMs: samplePulseIntervalMs(randomFn),
        locomotorDirection: randomLocomotorDirection(segmentType, randomFn),
        neuralBehavior: segmentType === SegmentType.Neural ? randomNeuralBehavior(randomFn) : 'approach',
      };
      mutated.push(newSegment);
    }

    if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.segmentRemovalChance && mutated.length > minSegments) {
      const idx = 1 + Math.floor(randomFn() * (mutated.length - 1));
      mutated.splice(idx, 1);
      for (let i = idx; i < mutated.length; i++) {
        if (mutated[i].parentIndex >= idx) {
          mutated[i] = { ...mutated[i], parentIndex: mutated[i].parentIndex - 1 };
        }
      }
    }

    result[gi] = {
      segments: mutated,
      symmetry: meta.symmetry,
      mode: meta.mode,
      angles: meta.angles,
      phaseMode: meta.phaseMode,
      phaseSpread: meta.phaseSpread,
      neuralPulseIntervalMs: meta.neuralPulseIntervalMs
    };
  }

  totalLimbs = getTotalLimbs(result);

  if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.groupAddChance && result.length < GENOME_LIMITS_CONSTANTS.maxLimbGroups && totalLimbs < GENOME_LIMITS_CONSTANTS.maxTotalLimbs) {
    const availableLimbs = GENOME_LIMITS_CONSTANTS.maxTotalLimbs - totalLimbs;
    if (availableLimbs >= 1) {
      const sym = 1 + Math.floor(randomFn() * availableLimbs);
      const rootType = pickRandomSegmentType(randomFn);
      const newGroup: LimbGroupDef = {
        segments: [{
          length: GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength + randomFn() * (GENOME_GENERATION_CONSTANTS.generatedMaxSegmentLength - GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength),
          angle: 0,
          type: rootType,
          parentIndex: -1,
          pulseIntervalMs: samplePulseIntervalMs(randomFn),
          locomotorDirection: randomLocomotorDirection(rootType, randomFn),
          neuralBehavior: rootType === SegmentType.Neural ? randomNeuralBehavior(randomFn) : 'approach',
        }],
        symmetry: sym,
        mode: SYMMETRY_MODES[Math.floor(randomFn() * SYMMETRY_MODES.length)],
        angles: generateSymmetryAngles(sym),
        phaseMode: PHASE_MODES[Math.floor(randomFn() * PHASE_MODES.length)],
        phaseSpread: randomFn(),
        neuralPulseIntervalMs: samplePulseIntervalMs(randomFn)
      };
      result.push(newGroup);
      totalLimbs = getTotalLimbs(result);
      for (const g of result) {
        const max = getMaxSegmentsForGroup(
          g.symmetry,
          totalLimbs,
          config.genomeBaseSegmentBudget,
          config.genomeSymmetrySegmentBonus
        );
        g.segments = pruneSegmentsToLimit(g.segments, max);
      }
    }
  }

  if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.groupRemovalChance && result.length > 1) {
    const idx = Math.floor(randomFn() * result.length);
    result.splice(idx, 1);
  }

  for (let gi = 0; gi < result.length; gi++) {
    result[gi] = enforceMinSegmentsPerGroup(result[gi], minSegments);
  }

  if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.groupSplitChance && result.length < GENOME_LIMITS_CONSTANTS.maxLimbGroups) {
    const splitIdx = result.findIndex(g => g.symmetry >= 2);
    if (splitIdx >= 0) {
      const group = result[splitIdx];
      const halfSym = Math.floor(group.symmetry / 2);
      if (halfSym >= 1 && getTotalLimbs(result) - group.symmetry + halfSym * 2 <= GENOME_LIMITS_CONSTANTS.maxTotalLimbs) {
        const angles1: number[] = [];
        const angles2: number[] = [];
        for (let i = 0; i < halfSym; i++) {
          angles1.push(group.angles[i] ?? (360 / halfSym) * i);
        }
        for (let i = halfSym; i < group.symmetry; i++) {
          angles2.push(group.angles[i] ?? (360 / halfSym) * (i - halfSym));
        }
        const newTotalLimbs = getTotalLimbs(result) - group.symmetry + halfSym * 2;
        const max1 = getMaxSegmentsForGroup(
          halfSym,
          newTotalLimbs,
          config.genomeBaseSegmentBudget,
          config.genomeSymmetrySegmentBonus
        );
        const max2 = getMaxSegmentsForGroup(
          group.symmetry - halfSym,
          newTotalLimbs,
          config.genomeBaseSegmentBudget,
          config.genomeSymmetrySegmentBonus
        );
        const prunedSegments = pruneSegmentsToLimit(group.segments, Math.min(max1, max2));
        result[splitIdx] = { ...group, segments: prunedSegments, symmetry: halfSym, angles: angles1 };
        result.push({ ...group, segments: [...prunedSegments], symmetry: group.symmetry - halfSym, angles: angles2 });
      }
    }
  }

  if (randomFn() < config.mutationRate * GENOME_MUTATION_CONSTANTS.groupMergeChance && result.length >= 2) {
    const idx1 = Math.floor(randomFn() * result.length);
    let idx2 = Math.floor(randomFn() * result.length);
    while (idx2 === idx1) idx2 = Math.floor(randomFn() * result.length);

    const g1 = result[Math.min(idx1, idx2)];
    const g2 = result[Math.max(idx1, idx2)];
    const mergedSym = Math.min(GENOME_LIMITS_CONSTANTS.maxTotalLimbs, g1.symmetry + g2.symmetry);
    const mergedAngles = [...g1.angles, ...g2.angles.slice(0, mergedSym - g1.symmetry)];

    const g1First = randomFn() < 0.5;
    const first = g1First ? g1 : g2;
    const second = g1First ? g2 : g1;
    const mergedSegments: SegmentDef[] = [
      ...first.segments,
      ...second.segments.map(s => ({
        ...s,
        parentIndex: s.parentIndex >= 0 ? s.parentIndex + first.segments.length : -1
      }))
    ];

    const newTotalLimbs = getTotalLimbs(result) - g1.symmetry - g2.symmetry + mergedSym;
    const newMaxPerGroup = getMaxSegmentsForGroup(
      mergedSym,
      newTotalLimbs,
      config.genomeBaseSegmentBudget,
      config.genomeSymmetrySegmentBonus
    );
    const prunedSegments = pruneSegmentsToLimit(mergedSegments, newMaxPerGroup);
    result.splice(Math.max(idx1, idx2), 1);
    result[Math.min(idx1, idx2)] = {
      segments: prunedSegments,
      symmetry: mergedSym,
      mode: randomFn() < 0.5 ? g1.mode : g2.mode,
      angles: mergedAngles,
      phaseMode: randomFn() < 0.5 ? g1.phaseMode : g2.phaseMode,
      phaseSpread: (g1.phaseSpread + g2.phaseSpread) / 2,
      neuralPulseIntervalMs: randomFn() < 0.5 ? g1.neuralPulseIntervalMs : g2.neuralPulseIntervalMs
    };
  }

  return result;
}

function enforceMinSegmentsPerGroup(group: LimbGroupDef, minSegments: number): LimbGroupDef {
  if (group.segments.length >= minSegments) return group;

  const newSegments: SegmentDef[] = [...group.segments];
  while (newSegments.length < minSegments) {
    const parentIndex = Math.floor(Math.random() * newSegments.length);
    const segmentType = pickRandomSegmentType(Math.random);
    newSegments.push({
      length: GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength + Math.random() * (GENOME_GENERATION_CONSTANTS.generatedMaxSegmentLength - GENOME_GENERATION_CONSTANTS.generatedMinSegmentLength),
      angle: Math.random() * 360 - 180,
      type: segmentType,
      parentIndex,
      pulseIntervalMs: samplePulseIntervalMs(Math.random),
      locomotorDirection: randomLocomotorDirection(segmentType, Math.random),
      neuralBehavior: segmentType === SegmentType.Neural ? randomNeuralBehavior(Math.random) : 'approach',
    });
  }

  return { ...group, segments: newSegments };
}

export function mutate(code: string, config: Config, randomFn: RandomFn = Math.random): string {
  const groups = parseGroups(code);
  if (groups.length === 0) return code;

  const mutated = mutateGroups(groups, config, randomFn);
  if (mutated.length === 0) return code;

  return encodeGroups(mutated);
}
