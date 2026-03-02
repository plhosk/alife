import { CensusChangeAnalysis, CensusChangeRanking, CensusData, MetricChange, RunAnalysis } from './types';
import { getMetricValue, trunc } from './utils';

const CHANGE_TRACKED_METRICS = [
  'population',
  'genomeEntropy',
  'uniqueGenomes',
  'generationMax',
  'generationMean',
  'meanSegmentsPerEntity',
  'segmentDiversity',
  'meanTotalLength',
  'meanHpPercent',
  'meanFoodPercent',
  'meanReproPercent',
  'readyToReproduceCount',
  'mobileCount',
  'predatorCount',
  'producerCount',
  'defenderCount',
  'hybridCounts',
  'densityVariance',
  'coverageRatio',
  'meanNearestNeighbor',
  'ageMedianMs',
  'deathsByAttack',
  'deathsByStarvation',
];

export interface PopulationDynamics {
  growthRateFirstHalf: number;
  growthRateSecondHalf: number;
  plateauTimeRatio: number;
  oscillationAmplitude: number;
  oscillationFrequency: number;
  sustainedGrowthScore: number;
  earlyPlateauPenalty: number;
}

export function analyzePopulationDynamics(censusData: CensusData[]): PopulationDynamics {
  if (censusData.length < 3) {
    return {
      growthRateFirstHalf: 0,
      growthRateSecondHalf: 0,
      plateauTimeRatio: 1,
      oscillationAmplitude: 0,
      oscillationFrequency: 0,
      sustainedGrowthScore: 0,
      earlyPlateauPenalty: 0,
    };
  }

  const populations = censusData.map(c => c.population);
  const times = censusData.map(c => c.timeSec);
  const midIdx = Math.floor(populations.length / 2);

  const growthRateFirstHalf = calculateGrowthRate(
    populations.slice(0, midIdx + 1),
    times.slice(0, midIdx + 1)
  );
  const growthRateSecondHalf = calculateGrowthRate(
    populations.slice(midIdx),
    times.slice(midIdx)
  );

  const plateauTimeRatio = calculatePlateauTimeRatio(populations);
  const { amplitude, frequency } = calculateOscillationMetrics(populations);

  const firstHalfGrowth = growthRateFirstHalf;
  const secondHalfGrowth = growthRateSecondHalf;

  let sustainedGrowthScore = 0;
  if (secondHalfGrowth > 0) {
    sustainedGrowthScore = Math.min(1, secondHalfGrowth / (Math.abs(firstHalfGrowth) + 0.01));
  }

  let earlyPlateauPenalty = 0;
  if (firstHalfGrowth > 0.5 && Math.abs(secondHalfGrowth) < 0.1) {
    const plateauRatio = plateauTimeRatio;
    earlyPlateauPenalty = Math.min(1, plateauRatio * (firstHalfGrowth / (firstHalfGrowth + 0.01)));
  }

  return {
    growthRateFirstHalf,
    growthRateSecondHalf,
    plateauTimeRatio,
    oscillationAmplitude: amplitude,
    oscillationFrequency: frequency,
    sustainedGrowthScore,
    earlyPlateauPenalty,
  };
}

function calculateGrowthRate(values: number[], times: number[]): number {
  if (values.length < 2) return 0;

  const timeSpan = times[times.length - 1] - times[0];
  if (timeSpan <= 0) return 0;

  const startPop = values[0];
  const endPop = values[values.length - 1];

  if (startPop <= 0) return endPop > 0 ? 1 : 0;

  return (endPop - startPop) / startPop / (timeSpan / 600);
}

function calculatePlateauTimeRatio(populations: number[]): number {
  if (populations.length < 3) return 0;

  const maxPop = Math.max(...populations);
  if (maxPop <= 0) return 0;

  const plateauThreshold = maxPop * 0.9;
  let plateauCount = 0;

  for (let i = 1; i < populations.length; i++) {
    const prev = populations[i - 1];
    const curr = populations[i];
    if (prev >= plateauThreshold && curr >= plateauThreshold) {
      const change = Math.abs(curr - prev) / maxPop;
      if (change < 0.05) {
        plateauCount++;
      }
    }
  }

  return plateauCount / (populations.length - 1);
}

function calculateOscillationMetrics(populations: number[]): { amplitude: number; frequency: number } {
  if (populations.length < 4) {
    return { amplitude: 0, frequency: 0 };
  }

  const mean = populations.reduce((a, b) => a + b, 0) / populations.length;
  if (mean <= 0) {
    return { amplitude: 0, frequency: 0 };
  }

  let peakCount = 0;
  let troughCount = 0;
  let totalAmplitude = 0;

  for (let i = 1; i < populations.length - 1; i++) {
    const prev = populations[i - 1];
    const curr = populations[i];
    const next = populations[i + 1];

    if (curr > prev && curr > next) {
      peakCount++;
      totalAmplitude += (curr - mean) / mean;
    } else if (curr < prev && curr < next) {
      troughCount++;
      totalAmplitude += (mean - curr) / mean;
    }
  }

  const amplitude = totalAmplitude / Math.max(1, peakCount + troughCount);
  const frequency = (peakCount + troughCount) / populations.length;

  return { amplitude, frequency };
}

export function analyzeCensusChanges(runId: string, censusData: CensusData[]): CensusChangeAnalysis {
  if (censusData.length < 2) {
    return {
      runId,
      timeSpanSec: 0,
      censusCount: censusData.length,
      metricChanges: [],
      overallChangeScore: 0,
      stabilityScore: 1,
      volatilityScore: 0,
      dominantTrend: 'stable',
      keyInsights: [],
    };
  }

  const first = censusData[0];
  const last = censusData[censusData.length - 1];
  const timeSpanSec = last.timeSec - first.timeSec;

  const metricChanges: MetricChange[] = [];
  let totalAbsoluteChange = 0;
  let totalVolatility = 0;
  let increasingCount = 0;
  let decreasingCount = 0;
  let stableCount = 0;

  for (const metric of CHANGE_TRACKED_METRICS) {
    const values = censusData.map(c => getMetricValue(c, metric));
    const startValue = values[0];
    const endValue = values[values.length - 1];
    const absoluteChange = Math.abs(endValue - startValue);
    const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
    const percentChange = meanValue !== 0 ? ((endValue - startValue) / Math.abs(meanValue)) * 100 : 0;

    const volatility = calculateVolatility(values);
    const trend = determineTrend(values, volatility);

    totalAbsoluteChange += absoluteChange;
    totalVolatility += volatility;

    if (trend === 'increasing') increasingCount++;
    else if (trend === 'decreasing') decreasingCount++;
    else if (trend !== 'volatile') stableCount++;

    metricChanges.push({
      metric,
      startValue,
      endValue,
      absoluteChange,
      percentChange,
      trend,
      volatility,
    });
  }

  const overallChangeScore = totalAbsoluteChange / CHANGE_TRACKED_METRICS.length;
  const stabilityScore = stableCount / CHANGE_TRACKED_METRICS.length;
  const volatilityScore = totalVolatility / CHANGE_TRACKED_METRICS.length;

  let dominantTrend: 'growth' | 'decline' | 'oscillation' | 'stable';
  if (volatilityScore > 0.5) {
    dominantTrend = 'oscillation';
  } else if (increasingCount > decreasingCount && increasingCount > stableCount) {
    dominantTrend = 'growth';
  } else if (decreasingCount > increasingCount && decreasingCount > stableCount) {
    dominantTrend = 'decline';
  } else {
    dominantTrend = 'stable';
  }

  const keyInsights = generateKeyInsights(metricChanges, dominantTrend);

  return {
    runId,
    timeSpanSec,
    censusCount: censusData.length,
    metricChanges,
    overallChangeScore,
    stabilityScore,
    volatilityScore,
    dominantTrend,
    keyInsights,
  };
}

function calculateVolatility(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;

  let changes = 0;
  for (let i = 1; i < values.length; i++) {
    const change = Math.abs(values[i] - values[i - 1]) / Math.abs(mean);
    changes += change;
  }

  return changes / (values.length - 1);
}

function determineTrend(values: number[], volatility: number): 'increasing' | 'decreasing' | 'stable' | 'volatile' {
  if (values.length < 3) return 'stable';

  if (volatility > 0.3) return 'volatile';

  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
  const threshold = meanValue * 0.1;

  if (secondMean - firstMean > threshold) return 'increasing';
  if (firstMean - secondMean > threshold) return 'decreasing';
  return 'stable';
}

function generateKeyInsights(changes: MetricChange[], trend: string): string[] {
  const insights: string[] = [];

  const popChange = changes.find(c => c.metric === 'population');
  if (popChange) {
    if (popChange.percentChange > 50) {
      insights.push(`Population grew ${popChange.percentChange.toFixed(0)}%`);
    } else if (popChange.percentChange < -50) {
      insights.push(`Population declined ${Math.abs(popChange.percentChange).toFixed(0)}%`);
    }
  }

  const entropyChange = changes.find(c => c.metric === 'genomeEntropy');
  if (entropyChange) {
    if (entropyChange.trend === 'increasing') {
      insights.push('Diversity increasing over time');
    } else if (entropyChange.trend === 'decreasing') {
      insights.push('Diversity decreasing (potential monoculture)');
    }
  }

  const genChange = changes.find(c => c.metric === 'generationMax');
  if (genChange && genChange.trend === 'increasing') {
    insights.push(`Generations advancing (reached gen ${genChange.endValue})`);
  }

  const hybridChange = changes.find(c => c.metric === 'hybridCounts');
  if (hybridChange && hybridChange.percentChange > 100) {
    insights.push(`Hybrid entities increased ${hybridChange.percentChange.toFixed(0)}%`);
  }

  const predatorChange = changes.find(c => c.metric === 'predatorCount');
  const producerChange = changes.find(c => c.metric === 'producerCount');
  if (predatorChange && producerChange) {
    if (predatorChange.trend === 'increasing' && producerChange.trend === 'decreasing') {
      insights.push('Ecological shift: predators rising, producers declining');
    }
  }

  const densityChange = changes.find(c => c.metric === 'densityVariance');
  if (densityChange && densityChange.volatility > 0.5) {
    insights.push('High clustering volatility - dynamic spatial behavior');
  }

  if (trend === 'oscillation') {
    insights.push('Run exhibits oscillating dynamics');
  } else if (trend === 'stable') {
    insights.push('Run reached equilibrium state');
  }

  return insights.slice(0, 5);
}

export function generateCensusChangeRankings(runs: RunAnalysis[]): CensusChangeRanking[] {
  const rankings: CensusChangeRanking[] = [];
  const withChanges = runs.filter(r => r.censusChange && r.censusData.length >= 2);

  if (withChanges.length === 0) return [];

  const byDynamism = [...withChanges]
    .map(r => [r.runId, trunc(r.censusChange!.overallChangeScore)] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'most_dynamic',
    description: 'Runs with the most dramatic changes across all metrics',
    fields: ['runId', 'score'],
    runs: byDynamism.slice(0, 5),
  });

  const byStability = [...withChanges]
    .map(r => [r.runId, trunc(r.censusChange!.stabilityScore)] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'most_stable',
    description: 'Runs that maintained consistent metrics throughout',
    fields: ['runId', 'score'],
    runs: byStability.slice(0, 5),
  });

  const byVolatility = [...withChanges]
    .map(r => [r.runId, trunc(r.censusChange!.volatilityScore)] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'most_volatile',
    description: 'Runs with highly fluctuating metrics',
    fields: ['runId', 'score'],
    runs: byVolatility.slice(0, 5),
  });

  const trendingUp = [...withChanges]
    .filter(r => r.censusChange!.dominantTrend === 'growth')
    .map(r => {
      const popChange = r.censusChange!.metricChanges.find(c => c.metric === 'population');
      const genChange = r.censusChange!.metricChanges.find(c => c.metric === 'generationMax');
      return [r.runId, trunc((popChange?.percentChange || 0) + (genChange?.absoluteChange || 0) * 10)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'trending_up',
    description: 'Runs showing consistent growth patterns',
    fields: ['runId', 'score'],
    runs: trendingUp.slice(0, 5),
  });

  const trendingDown = [...withChanges]
    .filter(r => r.censusChange!.dominantTrend === 'decline')
    .map(r => {
      const popChange = r.censusChange!.metricChanges.find(c => c.metric === 'population');
      return [r.runId, trunc(Math.abs(popChange?.percentChange || 0))] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'trending_down',
    description: 'Runs showing decline patterns (may lead to collapse)',
    fields: ['runId', 'score'],
    runs: trendingDown.slice(0, 5),
  });

  const oscillating = [...withChanges]
    .filter(r => r.censusChange!.dominantTrend === 'oscillation')
    .map(r => [r.runId, trunc(r.censusChange!.volatilityScore)] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  rankings.push({
    category: 'oscillating',
    description: 'Runs with cyclic or oscillating population dynamics',
    fields: ['runId', 'score'],
    runs: oscillating.slice(0, 5),
  });

  return rankings;
}
