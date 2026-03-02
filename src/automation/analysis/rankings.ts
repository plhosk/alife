import { MetricRanking, RunAnalysis } from './types';
import { getMetricValue, trunc } from './utils';
import { hashSettings } from '../census';
import { analyzePopulationDynamics, PopulationDynamics } from './censusChanges';

interface MetricDefinition {
  key: string;
  desc: string;
  higherBetter: boolean;
  getValue: (run: RunAnalysis) => number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getSegmentBalanceScore(run: RunAnalysis): number {
  const percentages = run.finalCensus?.segmentPercentages;
  if (!percentages) return 0;

  const parts = [
    percentages.Arm ?? 0,
    percentages.Att ?? 0,
    percentages.Loc ?? 0,
    percentages.Pho ?? 0,
  ];
  const total = parts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  const normalized = parts.map(value => value / total);
  const target = 0.25;
  const l1Distance = normalized.reduce((sum, value) => sum + Math.abs(value - target), 0);
  const maxL1Distance = 1.5;
  return clamp01(1 - l1Distance / maxL1Distance);
}

function getCullingPressure(run: RunAnalysis): number {
  if (!run.finalCensus) return 0;
  const totalDeaths = run.finalCensus.totalDeaths ?? 0;
  if (totalDeaths === 0) return 0;
  const cullingDeaths = run.finalCensus.deathsByCulling ?? 0;
  return cullingDeaths / totalDeaths;
}

function getGrowthDynamicsScore(dynamics: PopulationDynamics): number {
  let score = 0;

  if (dynamics.sustainedGrowthScore > 0.3) {
    score += dynamics.sustainedGrowthScore * 0.4;
  }

  if (dynamics.oscillationAmplitude > 0.1 && dynamics.oscillationFrequency > 0.1) {
    const oscillationBonus = Math.min(1, dynamics.oscillationAmplitude * dynamics.oscillationFrequency * 5);
    score += oscillationBonus * 0.3;
  }

  score -= dynamics.earlyPlateauPenalty * 0.5;

  return clamp01(score);
}

function getCompositeDefaultCandidateScore(
  run: RunAnalysis,
  populationScale: number,
  entropyScale: number,
  growthDynamicsWeight: number = 0.15
): number {
  if (run.summary.collapseEvent || !run.finalCensus) {
    return 0;
  }

  const populationNorm = clamp01(run.summary.finalPopulation / Math.max(1, populationScale));
  const genomeEntropyNorm = clamp01(getMetricValue(run.finalCensus, 'genomeEntropy') / Math.max(0.0001, entropyScale));
  const segmentDiversityNorm = clamp01(getMetricValue(run.finalCensus, 'segmentDiversity') / 2);
  const segmentBalanceScore = getSegmentBalanceScore(run);
  const meanSegments = getMetricValue(run.finalCensus, 'meanSegmentsPerEntity');
  const generationDepth = getMetricValue(run.finalCensus, 'generationMax');
  const structuralComplexityNorm = clamp01((meanSegments - 2) / 6);
  const lineageDepthNorm = clamp01(generationDepth / 25);
  const complexityFloor = clamp01(structuralComplexityNorm * 0.7 + lineageDepthNorm * 0.3);

  const staticMetricsWeight = 1 - growthDynamicsWeight;
  const baseScore = clamp01(
    populationNorm * 0.24 * staticMetricsWeight
    + genomeEntropyNorm * 0.2 * staticMetricsWeight
    + segmentDiversityNorm * 0.16 * staticMetricsWeight
    + segmentBalanceScore * 0.2 * staticMetricsWeight
    + complexityFloor * 0.2 * staticMetricsWeight
  );

  const dynamics = analyzePopulationDynamics(run.censusData);
  const growthDynamicsScore = getGrowthDynamicsScore(dynamics);
  const dynamicsComponent = growthDynamicsScore * growthDynamicsWeight;

  const combinedScore = baseScore + dynamicsComponent;

  const cullingPressure = getCullingPressure(run);
  const cullingPenalty = clamp01(cullingPressure * 1.5);
  return clamp01(combinedScore * (1 - cullingPenalty * 0.25));
}

function getComplexityCandidateScore(
  run: RunAnalysis,
  populationScale: number,
  entropyScale: number,
  segmentScale: number,
  lengthScale: number,
  generationScale: number
): number {
  if (run.summary.collapseEvent || !run.finalCensus) {
    return 0;
  }

  const populationNorm = clamp01(run.summary.finalPopulation / Math.max(1, populationScale));
  const entropyNorm = clamp01(getMetricValue(run.finalCensus, 'genomeEntropy') / Math.max(0.0001, entropyScale));
  const segmentNorm = clamp01(getMetricValue(run.finalCensus, 'meanSegmentsPerEntity') / Math.max(0.0001, segmentScale));
  const lengthNorm = clamp01(getMetricValue(run.finalCensus, 'meanTotalLength') / Math.max(0.0001, lengthScale));
  const generationNorm = clamp01(getMetricValue(run.finalCensus, 'generationMax') / Math.max(1, generationScale));

  return clamp01(
    segmentNorm * 0.45
    + lengthNorm * 0.25
    + generationNorm * 0.2
    + entropyNorm * 0.05
    + populationNorm * 0.05
  );
}

export function generateRankings(runs: RunAnalysis[]): MetricRanking[] {
  const nonCollapsed = runs.filter(run => !run.summary.collapseEvent);
  const populationScale = Math.max(1, ...nonCollapsed.map(run => run.summary.finalPopulation));
  const entropyScale = Math.max(0.0001, ...nonCollapsed.map(run => getMetricValue(run.finalCensus, 'genomeEntropy')));
  const segmentScale = Math.max(0.0001, ...nonCollapsed.map(run => getMetricValue(run.finalCensus, 'meanSegmentsPerEntity')));
  const lengthScale = Math.max(0.0001, ...nonCollapsed.map(run => getMetricValue(run.finalCensus, 'meanTotalLength')));
  const generationScale = Math.max(1, ...nonCollapsed.map(run => getMetricValue(run.finalCensus, 'generationMax')));

  const metrics: MetricDefinition[] = [
    { key: 'population', desc: 'Final population count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'population') },
    { key: 'genomeEntropy', desc: 'Genome diversity (entropy)', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'genomeEntropy') },
    { key: 'uniqueGenomes', desc: 'Number of unique genomes', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'uniqueGenomes') },
    { key: 'generationMax', desc: 'Maximum generation reached', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'generationMax') },
    { key: 'meanSegmentsPerEntity', desc: 'Complexity (segments per entity)', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'meanSegmentsPerEntity') },
    { key: 'segmentDiversity', desc: 'Segment type diversity', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'segmentDiversity') },
    { key: 'segmentBalanceScore', desc: 'Balance across Arm/Att/Loc/Pho segment percentages', higherBetter: true, getValue: run => getSegmentBalanceScore(run) },
    { key: 'defaultCandidateScore', desc: 'Composite score for stable, diverse, segment-balanced defaults with complexity floor and growth dynamics', higherBetter: true, getValue: run => getCompositeDefaultCandidateScore(run, populationScale, entropyScale) },
    {
      key: 'complexityCandidateScore',
      desc: 'Composite score for viable, structurally complex entities',
      higherBetter: true,
      getValue: run => getComplexityCandidateScore(run, populationScale, entropyScale, segmentScale, lengthScale, generationScale)
    },
    { key: 'hybridCounts', desc: 'Hybrid entity count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'hybridCounts') },
    { key: 'densityVariance', desc: 'Spatial distribution variance', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'densityVariance') },
    { key: 'coverageRatio', desc: 'World coverage ratio', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'coverageRatio') },
    { key: 'meanNearestNeighbor', desc: 'Mean distance to nearest neighbor', higherBetter: false, getValue: run => getMetricValue(run.finalCensus, 'meanNearestNeighbor') },
    { key: 'meanHpPercent', desc: 'Average HP percentage', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'meanHpPercent') },
    { key: 'meanFoodPercent', desc: 'Average food percentage', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'meanFoodPercent') },
    { key: 'meanReproPercent', desc: 'Average reproductive readiness', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'meanReproPercent') },
    { key: 'readyToReproduceCount', desc: 'Entities ready to reproduce', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'readyToReproduceCount') },
    { key: 'mobileCount', desc: 'Mobile entity count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'mobileCount') },
    { key: 'predatorCount', desc: 'Predator entity count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'predatorCount') },
    { key: 'producerCount', desc: 'Producer entity count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'producerCount') },
    { key: 'defenderCount', desc: 'Defender entity count', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'defenderCount') },
    { key: 'meanTotalLength', desc: 'Average entity size', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'meanTotalLength') },
    { key: 'birthsByReproduction', desc: 'Total births by reproduction', higherBetter: true, getValue: run => getMetricValue(run.finalCensus, 'birthsByReproduction') },
    { key: 'cullingPressure', desc: 'Fraction of deaths from culling (lower is better)', higherBetter: false, getValue: run => getCullingPressure(run) },
    { key: 'deathsByCulling', desc: 'Deaths by population culling', higherBetter: false, getValue: run => getMetricValue(run.finalCensus, 'deathsByCulling') },
    { key: 'sustainedGrowthScore', desc: 'Population growth in second half of run', higherBetter: true, getValue: run => analyzePopulationDynamics(run.censusData).sustainedGrowthScore },
    { key: 'oscillationScore', desc: 'Oscillation amplitude x frequency (dynamic ecosystems)', higherBetter: true, getValue: run => { const d = analyzePopulationDynamics(run.censusData); return d.oscillationAmplitude * d.oscillationFrequency; } },
    { key: 'earlyPlateauPenalty', desc: 'Penalty for rapid early growth followed by plateau', higherBetter: false, getValue: run => analyzePopulationDynamics(run.censusData).earlyPlateauPenalty },
  ];

  const rankings = metrics.map(({ key, desc, higherBetter, getValue }) => {
    const sorted = [...runs]
      .map(r => ({
        runId: r.runId,
        value: trunc(getValue(r)),
      }))
      .sort((a, b) => higherBetter ? b.value - a.value : a.value - b.value);

    return {
      metric: key,
      description: desc,
      higherIsBetter: higherBetter,
      fields: ['runId', 'value'] as ['runId', 'value'],
      runs: sorted.map(r => [r.runId, r.value] as [string, number]),
    };
  });

  const settingsGroups = new Map<string, number[]>();
  const complexitySettingsGroups = new Map<string, number[]>();
  for (const run of runs) {
    const key = hashSettings(run.settings as Partial<Record<string, unknown>>);
    const score = getCompositeDefaultCandidateScore(run, populationScale, entropyScale);
    const complexityScore = getComplexityCandidateScore(
      run,
      populationScale,
      entropyScale,
      segmentScale,
      lengthScale,
      generationScale
    );
    if (!settingsGroups.has(key)) {
      settingsGroups.set(key, []);
    }
    if (!complexitySettingsGroups.has(key)) {
      complexitySettingsGroups.set(key, []);
    }
    settingsGroups.get(key)!.push(score);
    complexitySettingsGroups.get(key)!.push(complexityScore);
  }

  const groupedScores = Array.from(settingsGroups.entries())
    .map(([settingsKey, scores]) => [settingsKey, trunc(median(scores))] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    metric: 'defaultCandidateScoreBySettings',
    description: 'Median composite score grouped by identical settings (excluding seeds)',
    higherIsBetter: true,
    fields: ['runId', 'value'] as ['runId', 'value'],
    runs: groupedScores,
  });

  const groupedComplexityScores = Array.from(complexitySettingsGroups.entries())
    .map(([settingsKey, scores]) => [settingsKey, trunc(median(scores))] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    metric: 'complexityCandidateScoreBySettings',
    description: 'Median complexity-focused composite score grouped by identical settings (excluding seeds)',
    higherIsBetter: true,
    fields: ['runId', 'value'] as ['runId', 'value'],
    runs: groupedComplexityScores,
  });

  return rankings;
}
