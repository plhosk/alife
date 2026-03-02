import { Entity, SegmentType, SymmetryMode, PhaseMode } from '../types';
import { CensusData } from './types';

export function collectCensus(
  entities: Entity[],
  runId: string,
  settingsHash: string,
  timeSec: number,
  simulationStats: {
    totalDeaths: number;
    totalBirths: number;
    birthsByReproduction: number;
    birthsBySpawning: number;
    deathsByStarvation: number;
    deathsByOldAge: number;
    deathsByAttack: number;
    deathsByCulling: number;
  },
  worldWidth: number,
  worldHeight: number
): CensusData {
  const living = entities.filter(e => !e.dead);
  const population = living.length;

  const generations = living.map(e => e.generation);
  const generationMax = generations.length > 0 ? Math.max(...generations) : 0;
  const generationMean = generations.length > 0 ? generations.reduce((a, b) => a + b, 0) / generations.length : 0;

  const agesMs = living.map(e => e.ageMs);
  const ageMinMs = agesMs.length > 0 ? Math.min(...agesMs) : 0;
  const ageMaxMs = agesMs.length > 0 ? Math.max(...agesMs) : 0;
  const ageMedianMs = calculateMedian(agesMs);
  const ageQ1Ms = calculatePercentile(agesMs, 25);
  const ageQ3Ms = calculatePercentile(agesMs, 75);

  const genomeCounts = new Map<string, number>();
  for (const entity of living) {
    genomeCounts.set(entity.genome, (genomeCounts.get(entity.genome) || 0) + 1);
  }
  const uniqueGenomes = genomeCounts.size;
  const genomeEntropy = calculateEntropy(genomeCounts, population);
  const dominantGenomeFreq = genomeCounts.size > 0 ? Math.max(...genomeCounts.values()) / population : 0;

  const segmentCounts: Record<SegmentType, number> = {
    [SegmentType.Armor]: 0,
    [SegmentType.Photosynth]: 0,
    [SegmentType.Locomotor]: 0,
    [SegmentType.Attack]: 0,
    [SegmentType.Neural]: 0,
  };

  let totalSegments = 0;
  for (const entity of living) {
    for (const segment of entity.segments) {
      segmentCounts[segment.type]++;
      totalSegments++;
    }
  }

  const segmentPercentages: Record<SegmentType, number> = {
    [SegmentType.Armor]: totalSegments > 0 ? segmentCounts[SegmentType.Armor] / totalSegments : 0,
    [SegmentType.Photosynth]: totalSegments > 0 ? segmentCounts[SegmentType.Photosynth] / totalSegments : 0,
    [SegmentType.Locomotor]: totalSegments > 0 ? segmentCounts[SegmentType.Locomotor] / totalSegments : 0,
    [SegmentType.Attack]: totalSegments > 0 ? segmentCounts[SegmentType.Attack] / totalSegments : 0,
    [SegmentType.Neural]: totalSegments > 0 ? segmentCounts[SegmentType.Neural] / totalSegments : 0,
  };

  const meanSegmentsPerEntity = population > 0 ? totalSegments / population : 0;
  const segmentDiversity = calculateSegmentDiversity(segmentCounts, totalSegments);

  const symmetryDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const symmetryModeDistribution: Record<SymmetryMode, number> = { radial: 0, mirror: 0 };
  const phaseModeDistribution: Record<PhaseMode, number> = { sync: 0, seq: 0, rand: 0 };
  const limbGroupDistribution: Record<number, number> = { 1: 0, 2: 0 };

  let totalLength = 0;
  for (const entity of living) {
    symmetryDistribution[entity.symmetry] = (symmetryDistribution[entity.symmetry] || 0) + 1;
    symmetryModeDistribution[entity.symmetryMode] = (symmetryModeDistribution[entity.symmetryMode] || 0) + 1;
    phaseModeDistribution[entity.phaseMode] = (phaseModeDistribution[entity.phaseMode] || 0) + 1;
    limbGroupDistribution[entity.limbGroups.length] = (limbGroupDistribution[entity.limbGroups.length] || 0) + 1;
    totalLength += entity.totalLength;
  }
  const meanTotalLength = population > 0 ? totalLength / population : 0;

  const hpValues = living.map(e => e.hp);
  const hpPercents = living.map(e => e.maxHp > 0 ? e.hp / e.maxHp : 0);
  const foodValues = living.map(e => e.foodBuffer);
  const foodPercents = living.map(e => e.maxFoodBuffer > 0 ? e.foodBuffer / e.maxFoodBuffer : 0);
  const reproValues = living.map(e => e.reproductiveBuffer);
  const reproPercents = living.map(e => e.reproductiveThreshold > 0 ? e.reproductiveBuffer / e.reproductiveThreshold : 0);

  const meanHp = average(hpValues);
  const meanHpPercent = average(hpPercents);
  const meanFood = average(foodValues);
  const meanFoodPercent = average(foodPercents);
  const meanRepro = average(reproValues);
  const meanReproPercent = average(reproPercents);

  const starvingCount = living.filter(e => e.maxFoodBuffer > 0 && e.foodBuffer / e.maxFoodBuffer < 0.25).length;
  const readyToReproduceCount = living.filter(e => e.reproductiveBuffer >= e.reproductiveThreshold).length;

  let mobileCount = 0;
  let predatorCount = 0;
  let producerCount = 0;
  let defenderCount = 0;
  let hybridCounts = 0;
  let dedicatedMobileCount = 0;
  let dedicatedPredatorCount = 0;
  let dedicatedProducerCount = 0;
  let dedicatedDefenderCount = 0;

  for (const entity of living) {
    const types = new Set(entity.segments.map(s => s.type));
    if (types.has(SegmentType.Locomotor)) mobileCount++;
    if (types.has(SegmentType.Attack)) predatorCount++;
    if (types.has(SegmentType.Photosynth)) producerCount++;
    if (types.has(SegmentType.Armor)) defenderCount++;
    if (types.size > 1) hybridCounts++;

    const segmentCount = entity.segments.length;
    if (segmentCount >= 12) {
      const typeCounts = new Map<SegmentType, number>();
      for (const seg of entity.segments) {
        typeCounts.set(seg.type, (typeCounts.get(seg.type) ?? 0) + 1);
      }
      if ((typeCounts.get(SegmentType.Locomotor) ?? 0) / segmentCount >= 0.5) dedicatedMobileCount++;
      if ((typeCounts.get(SegmentType.Attack) ?? 0) / segmentCount >= 0.25) dedicatedPredatorCount++;
      if ((typeCounts.get(SegmentType.Photosynth) ?? 0) / segmentCount >= 0.5) dedicatedProducerCount++;
      if ((typeCounts.get(SegmentType.Armor) ?? 0) / segmentCount >= 0.25) dedicatedDefenderCount++;
    }
  }

  const worldArea = worldWidth * worldHeight;
  
  const coverageRatio = worldArea > 0 
    ? living.reduce((sum, e) => sum + Math.PI * e.boundingRadius * e.boundingRadius, 0) / worldArea 
    : 0;

  let meanNearestNeighbor = 0;
  if (living.length > 1) {
    let totalNearestDist = 0;
    for (let i = 0; i < living.length; i++) {
      let minDist = Infinity;
      for (let j = 0; j < living.length; j++) {
        if (i !== j) {
          const dx = living[i].position.x - living[j].position.x;
          const dy = living[i].position.y - living[j].position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) minDist = dist;
        }
      }
      if (minDist !== Infinity) totalNearestDist += minDist;
    }
    meanNearestNeighbor = totalNearestDist / living.length;
  }

  const densityCellSize = 150;
  const densityCols = Math.ceil(worldWidth / densityCellSize);
  const densityRows = Math.ceil(worldHeight / densityCellSize);
  const cellCounts = new Map<string, number>();
  for (const entity of living) {
    const col = Math.floor(entity.position.x / densityCellSize);
    const row = Math.floor(entity.position.y / densityCellSize);
    const key = `${col},${row}`;
    cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
  }
  const densities: number[] = [];
  for (let r = 0; r < densityRows; r++) {
    for (let c = 0; c < densityCols; c++) {
      densities.push(cellCounts.get(`${c},${r}`) || 0);
    }
  }
  const meanDensity = densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0;
  const densityVariance = densities.length > 0 
    ? densities.reduce((sum, d) => sum + (d - meanDensity) * (d - meanDensity), 0) / densities.length 
    : 0;

  return {
    runId,
    settingsHash,
    timeSec,
    population,
    generationMax,
    generationMean,
    ageMinMs,
    ageMaxMs,
    ageMedianMs,
    ageQ1Ms,
    ageQ3Ms,
    totalDeaths: simulationStats.totalDeaths,
    totalBirths: simulationStats.totalBirths,
    birthsByReproduction: simulationStats.birthsByReproduction,
    birthsBySpawning: simulationStats.birthsBySpawning,
    deathsByStarvation: simulationStats.deathsByStarvation,
    deathsByOldAge: simulationStats.deathsByOldAge,
    deathsByAttack: simulationStats.deathsByAttack,
    deathsByCulling: simulationStats.deathsByCulling,
    uniqueGenomes,
    genomeEntropy,
    dominantGenomeFreq,
    segmentCounts,
    segmentPercentages,
    meanSegmentsPerEntity,
    segmentDiversity,
    symmetryDistribution,
    symmetryModeDistribution,
    meanTotalLength,
    limbGroupDistribution,
    phaseModeDistribution,
    meanHp,
    meanHpPercent,
    meanFood,
    meanFoodPercent,
    meanRepro,
    meanReproPercent,
    starvingCount,
    readyToReproduceCount,
    mobileCount,
    predatorCount,
    producerCount,
    defenderCount,
    hybridCounts,
    dedicatedMobileCount,
    dedicatedPredatorCount,
    dedicatedProducerCount,
    dedicatedDefenderCount,
    coverageRatio,
    meanNearestNeighbor,
    densityVariance,
  };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function calculateEntropy(counts: Map<string, number>, total: number): number {
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function calculateSegmentDiversity(counts: Record<SegmentType, number>, total: number): number {
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of Object.values(counts)) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const SEED_KEYS = new Set([
  'initialRandomSeed',
  'initialRandomSeedPerRunStep',
  'evolutionRandomSeed',
  'evolutionRandomSeedPerRunStep',
]);

export function hashSettings(settings: object): string {
  const sorted = Object.entries(settings as Record<string, unknown>)
    .filter(([k, v]) => v !== undefined && !SEED_KEYS.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join('&');
}
