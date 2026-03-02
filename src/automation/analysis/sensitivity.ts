import { SensitivityAnalysisResult, SobolSensitivityIndices, ParameterSensitivityRanking, RunAnalysis } from './types';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return mean(values.map(value => (value - avg) * (value - avg)));
}

function extractParameterKeys(runs: RunAnalysis[]): string[] {
  if (runs.length === 0) return [];
  const keys = new Set<string>();
  for (const run of runs) {
    for (const key of Object.keys(run.settings)) {
      if (typeof run.settings[key] === 'number') {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

function binValues(values: number[], binCount: number = 5): number[] {
  const n = values.length;
  if (n < binCount) {
    return values.map(() => 0);
  }

  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const binLabels = new Array(n);
  const binSize = Math.floor(n / binCount);

  for (let b = 0; b < binCount; b++) {
    const start = b * binSize;
    const end = b === binCount - 1 ? n : (b + 1) * binSize;
    for (let j = start; j < end; j++) {
      binLabels[sorted[j].i] = b;
    }
  }

  return binLabels;
}

function computeSobolIndices(
  samples: Record<string, unknown>[],
  outputs: number[],
  parameterKeys: string[]
): SobolSensitivityIndices {
  const n = samples.length;
  const k = parameterKeys.length;

  if (n < 10) {
    const result: SobolSensitivityIndices = { firstOrder: {}, totalOrder: {} };
    for (const key of parameterKeys) {
      result.firstOrder[key] = 0;
      result.totalOrder[key] = 0;
    }
    result.warning = 'Insufficient samples for reliable Sobol index estimation (need >= 10)';
    return result;
  }

  const outputVariance = variance(outputs);
  if (outputVariance === 0) {
    const result: SobolSensitivityIndices = { firstOrder: {}, totalOrder: {} };
    for (const key of parameterKeys) {
      result.firstOrder[key] = 0;
      result.totalOrder[key] = 0;
    }
    result.warning = 'Zero output variance - all samples produce identical outputs';
    return result;
  }

  const firstOrder: Record<string, number> = {};
  const totalOrder: Record<string, number> = {};

  const binCount = Math.max(3, Math.min(8, Math.floor(n / 5)));

  for (let i = 0; i < k; i++) {
    const paramKey = parameterKeys[i];
    const paramValues = samples.map(s => s[paramKey] as number ?? 0);
    const uniqueParamValues = [...new Set(paramValues)];

    if (uniqueParamValues.length < 3) {
      firstOrder[paramKey] = 0;
      totalOrder[paramKey] = 0;
      continue;
    }

    const bins = binValues(paramValues, binCount);
    const binOutputs = new Map<number, number[]>();

    for (let j = 0; j < n; j++) {
      const bin = bins[j];
      if (!binOutputs.has(bin)) {
        binOutputs.set(bin, []);
      }
      binOutputs.get(bin)!.push(outputs[j]);
    }

    const conditionalVariances: number[] = [];
    for (const binOutputsArray of binOutputs.values()) {
      if (binOutputsArray.length > 1) {
        conditionalVariances.push(variance(binOutputsArray));
      }
    }

    const meanConditionalVariance = mean(conditionalVariances.length > 0 ? conditionalVariances : [outputVariance]);
    const firstOrderVariance = Math.max(0, outputVariance - meanConditionalVariance);
    firstOrder[paramKey] = firstOrderVariance / outputVariance;

    const sortedIndices = [...Array(n).keys()].sort((a, b) => paramValues[a] - paramValues[b]);
    const windowSize = Math.max(2, Math.floor(n / binCount));
    let totalEffectSum = 0;
    let pairCount = 0;

    for (let j = 0; j < n; j++) {
      const centerIdx = sortedIndices[j];
      const centerParam = paramValues[centerIdx];
      const centerOutput = outputs[centerIdx];

      for (let w = Math.max(0, j - windowSize); w <= Math.min(n - 1, j + windowSize); w++) {
        const otherIdx = sortedIndices[w];
        if (otherIdx !== centerIdx) {
          const otherParam = paramValues[otherIdx];
          const paramDiff = Math.abs(centerParam - otherParam);
          const maxRange = Math.max(...paramValues) - Math.min(...paramValues);
          if (maxRange > 0 && paramDiff / maxRange < 0.15) {
            totalEffectSum += (centerOutput - outputs[otherIdx]) ** 2;
            pairCount++;
          }
        }
      }
    }

    if (pairCount > 0) {
      const meanSquaredDiff = totalEffectSum / pairCount;
      totalOrder[paramKey] = Math.max(0, 0.5 * meanSquaredDiff / outputVariance);
    } else {
      totalOrder[paramKey] = firstOrder[paramKey];
    }

    if (totalOrder[paramKey] < firstOrder[paramKey]) {
      totalOrder[paramKey] = firstOrder[paramKey];
    }

    totalOrder[paramKey] = Math.min(1, totalOrder[paramKey]);
    firstOrder[paramKey] = Math.min(1, firstOrder[paramKey]);
  }

  return { firstOrder, totalOrder };
}

function computeRankCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;

  const rank = (arr: number[]): number[] => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) {
      ranks[sorted[i].i] = i + 1;
    }
    return ranks;
  };

  const xRanks = rank(x);
  const yRanks = rank(y);

  let dSquared = 0;
  for (let i = 0; i < n; i++) {
    const d = xRanks[i] - yRanks[i];
    dSquared += d * d;
  }

  return 1 - (6 * dSquared) / (n * (n * n - 1));
}

interface ParameterSignal {
  parameter: string;
  correlation: number;
  trend: 'up' | 'down' | 'mixed';
  strength: 'weak' | 'moderate' | 'strong';
}

function analyzeParameterSignals(
  samples: Record<string, unknown>[],
  outputs: number[],
  parameterKeys: string[]
): ParameterSignal[] {
  const signals: ParameterSignal[] = [];

  for (const key of parameterKeys) {
    const paramValues = samples.map(s => s[key] as number ?? 0);
    const popCorr = computeRankCorrelation(paramValues, outputs);
    const absCorr = Math.abs(popCorr);

    let trend: 'up' | 'down' | 'mixed' = 'mixed';
    if (popCorr >= 0.15) trend = 'up';
    else if (popCorr <= -0.15) trend = 'down';

    let strength: 'weak' | 'moderate' | 'strong' = 'weak';
    if (absCorr >= 0.55) strength = 'strong';
    else if (absCorr >= 0.3) strength = 'moderate';

    signals.push({
      parameter: key,
      correlation: popCorr,
      trend,
      strength,
    });
  }

  return signals.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

function rankParametersByInfluence(
  metrics: Record<string, SobolSensitivityIndices>,
  parameterKeys: string[]
): ParameterSensitivityRanking[] {
  const influence: Record<string, { avgTotalOrder: number; byMetric: Record<string, { firstOrder: number; totalOrder: number }> }> = {};

  for (const key of parameterKeys) {
    let totalInfluence = 0;
    let metricCount = 0;
    const byMetric: Record<string, { firstOrder: number; totalOrder: number }> = {};

    for (const [metricName, metricData] of Object.entries(metrics)) {
      const totalIdx = metricData.totalOrder?.[key] ?? 0;
      totalInfluence += totalIdx;
      metricCount++;
      byMetric[metricName] = {
        firstOrder: metricData.firstOrder?.[key] ?? 0,
        totalOrder: metricData.totalOrder?.[key] ?? 0,
      };
    }

    influence[key] = {
      avgTotalOrder: metricCount > 0 ? totalInfluence / metricCount : 0,
      byMetric,
    };
  }

  return Object.entries(influence)
    .sort((a, b) => b[1].avgTotalOrder - a[1].avgTotalOrder)
    .map(([key, data]) => ({
      parameter: key,
      avgTotalOrder: data.avgTotalOrder,
      byMetric: data.byMetric,
    }));
}

export function analyzeSensitivity(
  runs: RunAnalysis[],
  outputMetrics: string[] = ['defaultCandidateScore', 'finalPopulation', 'genomeEntropy']
): SensitivityAnalysisResult {
  const parameterKeys = extractParameterKeys(runs);

  if (parameterKeys.length === 0) {
    return {
      metrics: {},
      ranking: [],
      parameterKeys: [],
      sampleCount: runs.length,
      warning: 'No numeric parameters found in run settings',
    };
  }

  const samples = runs.map(r => r.settings);
  const metricValues: Record<string, number[]> = {};

  for (const metricName of outputMetrics) {
    if (metricName === 'defaultCandidateScore') {
      metricValues[metricName] = runs.map(r => {
        const finalCensus = r.finalCensus;
        if (!finalCensus || r.summary.collapseEvent) return 0;

        const populationScale = Math.max(1, ...runs
          .filter(x => !x.summary.collapseEvent)
          .map(x => x.summary.finalPopulation ?? 0));
        const entropyScale = Math.max(0.0001, ...runs
          .filter(x => !x.summary.collapseEvent && x.finalCensus)
          .map(x => x.finalCensus!.genomeEntropy ?? 0));

        const populationNorm = Math.min(1, Math.max(0, (r.summary.finalPopulation ?? 0) / populationScale));
        const genomeEntropyNorm = Math.min(1, Math.max(0, (finalCensus.genomeEntropy ?? 0) / entropyScale));
        const segmentDiversityNorm = Math.min(1, Math.max(0, (finalCensus.segmentDiversity ?? 0) / 2));

        const p = finalCensus.segmentPercentages;
        const parts = [p.Arm ?? 0, p.Att ?? 0, p.Loc ?? 0, p.Pho ?? 0];
        const total = parts.reduce((sum, value) => sum + value, 0);
        let balance = 0;
        if (total > 0) {
          const normalized = parts.map(value => value / total);
          const l1Distance = normalized.reduce((sum, value) => sum + Math.abs(value - 0.25), 0);
          balance = Math.min(1, Math.max(0, 1 - l1Distance / 1.5));
        }

        const structuralComplexityNorm = Math.min(1, Math.max(0, ((finalCensus.meanSegmentsPerEntity ?? 0) - 2) / 6));
        const lineageDepthNorm = Math.min(1, Math.max(0, (finalCensus.generationMax ?? 0) / 25));
        const complexityFloor = Math.min(1, Math.max(0, structuralComplexityNorm * 0.7 + lineageDepthNorm * 0.3));

        const baseScore = Math.min(1, Math.max(0,
          populationNorm * 0.24
          + genomeEntropyNorm * 0.2
          + segmentDiversityNorm * 0.16
          + balance * 0.2
          + complexityFloor * 0.2
        ));

        const totalDeaths = finalCensus.totalDeaths ?? 0;
        const cullingPressure = totalDeaths > 0 ? (finalCensus.deathsByCulling ?? 0) / totalDeaths : 0;
        const cullingPenalty = Math.min(1, Math.max(0, cullingPressure * 1.5));

        return baseScore * (1 - cullingPenalty * 0.25);
      });
    } else if (metricName === 'finalPopulation') {
      metricValues[metricName] = runs.map(r => r.summary.finalPopulation ?? 0);
    } else if (metricName === 'genomeEntropy') {
      metricValues[metricName] = runs.map(r => r.finalCensus?.genomeEntropy ?? 0);
    } else {
      metricValues[metricName] = runs.map(() => 0);
    }
  }

  const metrics: Record<string, SobolSensitivityIndices> = {};

  for (const metricName of outputMetrics) {
    const outputs = metricValues[metricName] ?? runs.map(() => 0);
    const indices = computeSobolIndices(samples, outputs, parameterKeys);
    const signals = analyzeParameterSignals(samples, outputs, parameterKeys);

    metrics[metricName] = {
      firstOrder: indices.firstOrder,
      totalOrder: indices.totalOrder,
      warning: indices.warning,
      parameterSignals: signals,
    };
  }

  const ranking = rankParametersByInfluence(metrics, parameterKeys);

  return {
    metrics,
    ranking,
    parameterKeys,
    sampleCount: runs.length,
  };
}

export function formatParameterName(key: string): string {
  const nameMap: Record<string, string> = {
    photosynthesisRate: 'photosynthesis rate',
    environmentNutrientPhotosynthMinMultiplier: 'nutrient→photosynth multiplier',
    environmentNutrientConsumptionRate: 'nutrient consumption rate',
    locomotorFoodCost: 'locomotor food cost',
    impulseNutrientDemandRate: 'impulse nutrient demand',
    environmentLocomotorNutrientToFoodScale: 'locomotor nutrient→food scale',
    attackDamagePerLength: 'attack damage per length',
    foodStealPerDamage: 'food steal per damage',
    locomotorImpulsePerLength: 'locomotor impulse per length',
    environmentNutrientRegenRate: 'nutrient regen rate',
    environmentFootprintScale: 'environment footprint scale',
    maxPopulation: 'max population',
  };
  return nameMap[key] || key;
}

export function interpretInfluence(value: number): string {
  if (value > 0.5) return 'Very strong';
  if (value > 0.2) return 'Strong';
  if (value > 0.1) return 'Moderate';
  if (value > 0.05) return 'Weak';
  return 'Minimal';
}
