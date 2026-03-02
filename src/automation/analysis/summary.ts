import { hashSettings } from '../census';
import {
  AnalysisSummary,
  AnalysisSummaryCandidate,
  AnalysisSummaryInterestingPreset,
  AnalysisSummaryOptions,
  CensusData,
  ExperimentResult,
  InterestingPresetType,
  RunAnalysis,
  SummaryConfidence,
} from './types';
import { getFinalCensus, trunc } from './utils';
import { analyzeSensitivity } from './sensitivity';

interface RunScoreRecord {
  runId: string;
  settingsHash: string;
  settings: Record<string, unknown>;
  finalCensus: CensusData | null;
  censusData: CensusData[];
  collapseEvent: boolean;
  defaultCandidateScore: number;
  segmentBalanceScore: number;
  dedicatedRoleCoexistenceScore: number;
  cullingPressure: number;
  populationSwingRatio: number;
  populationDynamics: PopulationDynamics;
}

interface PopulationDynamics {
  growthRateFirstHalf: number;
  growthRateSecondHalf: number;
  plateauTimeRatio: number;
  oscillationAmplitude: number;
  oscillationFrequency: number;
  sustainedGrowthScore: number;
  earlyPlateauPenalty: number;
}

interface GroupAggregate {
  candidateId: string;
  settings: Record<string, unknown>;
  runs: RunScoreRecord[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = mean(values.map(value => (value - avg) * (value - avg)));
  return Math.sqrt(variance);
}

function cv(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  if (avg === 0) return 0;
  return stdDev(values) / Math.abs(avg);
}

function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  const xMean = mean(x.slice(0, n));
  const yMean = mean(y.slice(0, n));
  let num = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    num += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }
  const denom = Math.sqrt(sumX * sumY);
  if (denom === 0) return 0;
  return num / denom;
}

function minOrZero(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

function maxOrZero(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

function latestMetric(censusData: CensusData[], metric: keyof CensusData): number {
  if (censusData.length === 0) return 0;
  const value = censusData[censusData.length - 1][metric];
  return typeof value === 'number' ? value : 0;
}

function populationSwingRatio(censusData: CensusData[]): number {
  const populations = censusData.map(census => census.population);
  if (populations.length === 0) return 0;
  const minPopulation = minOrZero(populations);
  const maxPopulation = maxOrZero(populations);
  if (maxPopulation <= 0) return 0;
  return (maxPopulation - minPopulation) / maxPopulation;
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
  const avg = mean(populations);
  if (avg <= 0) {
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
      totalAmplitude += (curr - avg) / avg;
    } else if (curr < prev && curr < next) {
      troughCount++;
      totalAmplitude += (avg - curr) / avg;
    }
  }
  const amplitude = totalAmplitude / Math.max(1, peakCount + troughCount);
  const frequency = (peakCount + troughCount) / populations.length;
  return { amplitude, frequency };
}

function analyzePopulationDynamics(censusData: CensusData[]): PopulationDynamics {
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

  let sustainedGrowthScore = 0;
  if (growthRateSecondHalf > 0) {
    sustainedGrowthScore = Math.min(1, growthRateSecondHalf / (Math.abs(growthRateFirstHalf) + 0.01));
  }

  let earlyPlateauPenalty = 0;
  if (growthRateFirstHalf > 0.5 && Math.abs(growthRateSecondHalf) < 0.1) {
    earlyPlateauPenalty = Math.min(1, plateauTimeRatio * (growthRateFirstHalf / (growthRateFirstHalf + 0.01)));
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

function getDedicatedRoleCoexistenceScore(census: CensusData | null): number {
  if (!census) return 0;
  const roleThreshold = 20;
  const mobile = clamp01((census.dedicatedMobileCount ?? 0) / roleThreshold);
  const predator = clamp01((census.dedicatedPredatorCount ?? 0) / roleThreshold);
  const producer = clamp01((census.dedicatedProducerCount ?? 0) / roleThreshold);
  const defender = clamp01((census.dedicatedDefenderCount ?? 0) / roleThreshold);
  return (mobile + predator + producer + defender) / 4;
}

function getCullingPressure(census: CensusData | null): number {
  if (!census) return 0;
  const totalDeaths = census.totalDeaths ?? 0;
  if (totalDeaths === 0) return 0;
  const cullingDeaths = census.deathsByCulling ?? 0;
  return cullingDeaths / totalDeaths;
}

function getSegmentBalanceScore(census: CensusData | null): number {
  const percentages = census?.segmentPercentages;
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
  const l1Distance = normalized.reduce((sum, value) => sum + Math.abs(value - 0.25), 0);
  return clamp01(1 - l1Distance / 1.5);
}

function getDefaultCandidateScore(
  census: CensusData | null,
  finalPopulation: number,
  collapsed: boolean,
  populationScale: number,
  entropyScale: number,
  cullingPressure: number,
  censusData: CensusData[],
  growthDynamicsWeight = 0.15
): number {
  if (collapsed || !census) return 0;

  const genomeEntropyNorm = clamp01((census.genomeEntropy ?? 0) / Math.max(0.0001, entropyScale));
  const segmentDiversityNorm = clamp01((census.segmentDiversity ?? 0) / 2);
  const segmentBalance = getSegmentBalanceScore(census);
  const structuralComplexityNorm = clamp01(((census.meanSegmentsPerEntity ?? 0) - 2) / 6);
  const lineageDepthNorm = clamp01((census.generationMax ?? 0) / 25);
  const complexityFloor = clamp01(structuralComplexityNorm * 0.7 + lineageDepthNorm * 0.3);
  const roleCoexistence = getDedicatedRoleCoexistenceScore(census);

  const staticMetricsWeight = 1 - growthDynamicsWeight;
  const baseScore = clamp01(
    genomeEntropyNorm * 0.20 * staticMetricsWeight
    + segmentDiversityNorm * 0.20 * staticMetricsWeight
    + segmentBalance * 0.20 * staticMetricsWeight
    + complexityFloor * 0.20 * staticMetricsWeight
    + roleCoexistence * 0.20 * staticMetricsWeight
  );

  const dynamics = analyzePopulationDynamics(censusData);
  const growthDynamicsScore = getGrowthDynamicsScore(dynamics);
  const dynamicsComponent = growthDynamicsScore * growthDynamicsWeight;

  const combinedScore = baseScore + dynamicsComponent;

  const cullingPenalty = clamp01(cullingPressure * 1.5);
  const cappedPopulationPenalty = finalPopulation >= populationScale ? 0.3 : 0;
  return clamp01(combinedScore * (1 - cullingPenalty * 0.25) * (1 - cappedPopulationPenalty));
}

function buildRuns(results: RunAnalysis[]): RunScoreRecord[] {
  const nonCollapsed = results.filter(run => !run.summary.collapseEvent);
  const populationScale = Math.max(1, ...nonCollapsed.map(run => run.summary.finalPopulation));
  const entropyScale = Math.max(0.0001, ...nonCollapsed.map(run => run.finalCensus?.genomeEntropy ?? 0));

  return results
    .map(run => {
      const settings = run.settings as Record<string, unknown>;
      const settingsHash = hashSettings(settings);
      const cullingPressure = getCullingPressure(run.finalCensus);
      const populationSwingRatioVal = populationSwingRatio(run.censusData);
      const populationDynamics = analyzePopulationDynamics(run.censusData);
      const defaultCandidateScore = getDefaultCandidateScore(
        run.finalCensus,
        run.summary.finalPopulation,
        run.summary.collapseEvent,
        populationScale,
        entropyScale,
        cullingPressure,
        run.censusData
      );
      const segmentBalanceScore = getSegmentBalanceScore(run.finalCensus);
      const dedicatedRoleCoexistenceScore = getDedicatedRoleCoexistenceScore(run.finalCensus);
      return {
        runId: run.runId,
        settingsHash,
        settings,
        finalCensus: run.finalCensus,
        censusData: run.censusData,
        collapseEvent: run.summary.collapseEvent,
        defaultCandidateScore,
        segmentBalanceScore,
        dedicatedRoleCoexistenceScore,
        cullingPressure,
        populationSwingRatio: populationSwingRatioVal,
        populationDynamics,
      };
    })
    .sort((a, b) => a.runId.localeCompare(b.runId));
}

function buildGroups(runs: RunScoreRecord[]): GroupAggregate[] {
  const grouped = new Map<string, GroupAggregate>();
  for (const run of runs) {
    if (!grouped.has(run.settingsHash)) {
      grouped.set(run.settingsHash, {
        candidateId: run.settingsHash,
        settings: run.settings,
        runs: [],
      });
    }
    grouped.get(run.settingsHash)?.runs.push(run);
  }
  return Array.from(grouped.values()).map(group => ({
    ...group,
    runs: [...group.runs].sort((a, b) => a.runId.localeCompare(b.runId)),
  }));
}

function classifyDecision(group: GroupAggregate): {
  decision: 'promote' | 'hold' | 'reject';
  confidence: SummaryConfidence;
  risks: string[];
} {
  const scores = group.runs.map(run => run.defaultCandidateScore);
  const populations = group.runs.map(run => run.finalCensus?.population ?? 0);
  const segmentBalances = group.runs.map(run => run.segmentBalanceScore);
  const meanSegments = group.runs.map(run => run.finalCensus?.meanSegmentsPerEntity ?? 0);
  const collapseCount = group.runs.filter(run => run.collapseEvent).length;
  const collapseRate = group.runs.length > 0 ? collapseCount / group.runs.length : 1;
  const cullingPressures = group.runs.map(run => run.cullingPressure);

  const dedicatedRoleMin = {
    mobile: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedMobileCount ?? 0)),
    predator: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedPredatorCount ?? 0)),
    producer: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedProducerCount ?? 0)),
    defender: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedDefenderCount ?? 0)),
  };

  const gateNoCollapse = collapseRate === 0;
  const gateDedicatedRolePresence = dedicatedRoleMin.mobile >= 5
    && dedicatedRoleMin.predator >= 5
    && dedicatedRoleMin.producer >= 5
    && dedicatedRoleMin.defender >= 5;
  const gateStability = cv(populations) <= 0.2 && cv(scores) <= 0.1;
  const gateBalance = median(segmentBalances) >= 0.45;
  const gateComplexity = median(meanSegments) >= 7;
  const gateLowCullingDependency = median(cullingPressures) < 0.5;

  const risks: string[] = [];
  if (!gateNoCollapse) risks.push('non-zero collapse rate across repeats');
  if (!gateDedicatedRolePresence) risks.push('dedicated role coexistence floor failed (need 5+ entities each with 12+ segments, 50%+ of one type)');
  if (!gateStability) risks.push('repeat dispersion is high for population or score');
  if (!gateBalance) risks.push('photosynth/locomotor balance is weak relative to balanced baseline');
  if (!gateComplexity) risks.push('entity structural complexity is too low across repeats');
  if (!gateLowCullingDependency) risks.push('high culling dependency indicates artificial population control');

  if (collapseRate >= 0.5 || median(populations) <= 0) {
    return { decision: 'reject', confidence: 'low', risks };
  }

  const gateScore =
    (gateNoCollapse ? 1 : 0)
    + (gateDedicatedRolePresence ? 1 : 0)
    + (gateStability ? 1 : 0)
    + (gateBalance ? 1 : 0)
    + (gateComplexity ? 1 : 0)
    + (gateLowCullingDependency ? 1 : 0);

  if (gateScore >= 5 && gateDedicatedRolePresence && gateComplexity && gateLowCullingDependency) {
    return {
      decision: 'promote',
      confidence: gateScore >= 6 ? 'high' : 'medium',
      risks,
    };
  }

  return {
    decision: 'hold',
    confidence: gateScore >= 3 ? 'medium' : 'low',
    risks,
  };
}

function asCandidate(group: GroupAggregate): AnalysisSummaryCandidate {
  const defaultScores = group.runs.map(run => run.defaultCandidateScore);
  const segmentBalances = group.runs.map(run => run.segmentBalanceScore);
  const dedicatedRoleCoexistenceScores = group.runs.map(run => run.dedicatedRoleCoexistenceScore);
  const populations = group.runs.map(run => run.finalCensus?.population ?? 0);
  const entropy = group.runs.map(run => run.finalCensus?.genomeEntropy ?? 0);
  const cullingPressures = group.runs.map(run => run.cullingPressure);
  const populationSwings = group.runs.map(run => run.populationSwingRatio);
  const collapseRate = group.runs.length > 0
    ? group.runs.filter(run => run.collapseEvent).length / group.runs.length
    : 1;

  const sustainedGrowthScores = group.runs.map(run => run.populationDynamics?.sustainedGrowthScore ?? 0);
  const oscillationScores = group.runs.map(run => {
    const d = run.populationDynamics;
    return d ? d.oscillationAmplitude * d.oscillationFrequency : 0;
  });
  const earlyPlateauPenalties = group.runs.map(run => run.populationDynamics?.earlyPlateauPenalty ?? 0);

  const roleCountsMin = {
    mobile: Math.min(...group.runs.map(run => run.finalCensus?.mobileCount ?? 0)),
    predator: Math.min(...group.runs.map(run => run.finalCensus?.predatorCount ?? 0)),
    producer: Math.min(...group.runs.map(run => run.finalCensus?.producerCount ?? 0)),
    defender: Math.min(...group.runs.map(run => run.finalCensus?.defenderCount ?? 0)),
  };

  const dedicatedRoleCountsMin = {
    mobile: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedMobileCount ?? 0)),
    predator: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedPredatorCount ?? 0)),
    producer: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedProducerCount ?? 0)),
    defender: Math.min(...group.runs.map(run => run.finalCensus?.dedicatedDefenderCount ?? 0)),
  };

  const classified = classifyDecision(group);

  return {
    candidateId: group.candidateId,
    runs: group.runs.map(run => run.runId),
    settings: group.settings,
    scores: {
      groupedDefaultCandidateScoreMean: trunc(mean(defaultScores)),
      groupedDefaultCandidateScoreMedian: trunc(median(defaultScores)),
      runDefaultCandidateScore: {
        min: trunc(minOrZero(defaultScores)),
        median: trunc(median(defaultScores)),
        max: trunc(maxOrZero(defaultScores)),
        cv: trunc(cv(defaultScores)),
      },
      segmentBalanceScore: {
        min: trunc(minOrZero(segmentBalances)),
        median: trunc(median(segmentBalances)),
        max: trunc(maxOrZero(segmentBalances)),
      },
      dedicatedRoleCoexistenceScore: {
        min: trunc(minOrZero(dedicatedRoleCoexistenceScores)),
        median: trunc(median(dedicatedRoleCoexistenceScores)),
        max: trunc(maxOrZero(dedicatedRoleCoexistenceScores)),
      },
      sustainedGrowthScore: {
        min: trunc(minOrZero(sustainedGrowthScores)),
        median: trunc(median(sustainedGrowthScores)),
        max: trunc(maxOrZero(sustainedGrowthScores)),
      },
      oscillationScore: {
        min: trunc(minOrZero(oscillationScores)),
        median: trunc(median(oscillationScores)),
        max: trunc(maxOrZero(oscillationScores)),
      },
      earlyPlateauPenalty: {
        min: trunc(minOrZero(earlyPlateauPenalties)),
        median: trunc(median(earlyPlateauPenalties)),
        max: trunc(maxOrZero(earlyPlateauPenalties)),
      },
    },
    health: {
      finalPopulation: {
        min: trunc(minOrZero(populations)),
        median: trunc(median(populations)),
        max: trunc(maxOrZero(populations)),
        cv: trunc(cv(populations)),
      },
      genomeEntropy: {
        min: trunc(minOrZero(entropy)),
        median: trunc(median(entropy)),
        max: trunc(maxOrZero(entropy)),
      },
      roleCountsMin,
      dedicatedRoleCountsMin,
      cullingPressure: {
        min: trunc(minOrZero(cullingPressures)),
        median: trunc(median(cullingPressures)),
        max: trunc(maxOrZero(cullingPressures)),
      },
      populationSwingRatio: {
        min: trunc(minOrZero(populationSwings)),
        median: trunc(median(populationSwings)),
        max: trunc(maxOrZero(populationSwings)),
      },
    },
    collapseRate: trunc(collapseRate),
    risks: classified.risks,
    decision: classified.decision,
    confidence: classified.confidence,
  };
}

function selectInterestingPreset(
  groups: AnalysisSummaryCandidate[],
  sourceGroupsById: Map<string, GroupAggregate>,
  presetType: InterestingPresetType,
  excludedCandidateIds: Set<string>
): AnalysisSummaryInterestingPreset | null {
  const viable = groups
    .filter(group => group.health.finalPopulation.median > 0 && group.collapseRate < 0.5)
    .filter(group => !excludedCandidateIds.has(group.candidateId));
  if (viable.length === 0) return null;

  const scoreFor = (group: AnalysisSummaryCandidate): number => {
    const source = sourceGroupsById.get(group.candidateId);
    const sourceRuns = source?.runs ?? [];
    const pop = group.health.finalPopulation.median;
    const entropy = group.health.genomeEntropy.median;
    const mobile = group.health.roleCountsMin.mobile;
    const predator = group.health.roleCountsMin.predator;
    const producer = group.health.roleCountsMin.producer;
    const defender = group.health.roleCountsMin.defender;
    const attackDeathsMedian = median(sourceRuns.map(run => latestMetric(run.censusData, 'deathsByAttack')));
    const densityVarianceMedian = median(sourceRuns.map(run => latestMetric(run.censusData, 'densityVariance')));
    const swingMedian = median(sourceRuns.map(run => populationSwingRatio(run.censusData)));
    const attackShareMedian = median(sourceRuns.map(run => run.finalCensus?.segmentPercentages.Att ?? 0));
    const locomotorShareMedian = median(sourceRuns.map(run => run.finalCensus?.segmentPercentages.Loc ?? 0));
    const photosynthShareMedian = median(sourceRuns.map(run => run.finalCensus?.segmentPercentages.Pho ?? 0));
    const armorShareMedian = median(sourceRuns.map(run => run.finalCensus?.segmentPercentages.Arm ?? 0));
    const foodPercentMedian = median(sourceRuns.map(run => run.finalCensus?.meanFoodPercent ?? 0));
    const hpPercentMedian = median(sourceRuns.map(run => run.finalCensus?.meanHpPercent ?? 0));
    const meanSegmentsMedian = median(sourceRuns.map(run => run.finalCensus?.meanSegmentsPerEntity ?? 0));
    const meanLengthMedian = median(sourceRuns.map(run => run.finalCensus?.meanTotalLength ?? 0));
    const generationMaxMedian = median(sourceRuns.map(run => run.finalCensus?.generationMax ?? 0));
    switch (presetType) {
      case 'high_combat':
        return attackDeathsMedian * 0.05 + predator * 1.5 + attackShareMedian * 220;
      case 'mobile_swarm':
        return mobile * 1.8 + locomotorShareMedian * 260 + pop * 0.04 + entropy * 15;
      case 'producer_garden':
        return producer * 1.6 + photosynthShareMedian * 260 + foodPercentMedian * 120 + entropy * 10;
      case 'defender_fortress':
        return defender * 1.7 + armorShareMedian * 260 + hpPercentMedian * 120 + pop * 0.03;
      case 'complexity':
        return meanSegmentsMedian * 55 + meanLengthMedian * 0.22 + generationMaxMedian * 2 + entropy * 8;
      case 'spatial_dynamic':
        return densityVarianceMedian * 0.05 + swingMedian * 220 + (mobile + predator) * 0.2 + entropy * 8;
    }
  };

  const ranked = [...viable]
    .map(group => ({ group, score: scoreFor(group) }))
    .sort((a, b) => b.score - a.score || a.group.candidateId.localeCompare(b.group.candidateId));

  const winner = ranked[0];
  const comparativeRank = ranked.findIndex(entry => entry.group.candidateId === winner.group.candidateId) + 1;
  const keyMetrics: Record<string, number> = {
    groupedDefaultCandidateScoreMedian: winner.group.scores.groupedDefaultCandidateScoreMedian,
    populationMedian: winner.group.health.finalPopulation.median,
    genomeEntropyMedian: winner.group.health.genomeEntropy.median,
    segmentBalanceMedian: winner.group.scores.segmentBalanceScore.median,
  };

  return {
    presetType,
    candidateId: winner.group.candidateId,
    runs: winner.group.runs,
    settings: winner.group.settings,
    evidence: {
      keyMetrics,
      comparativeRank,
    },
    viability: {
      collapseRate: winner.group.collapseRate,
      repeatStability: winner.group.health.finalPopulation.cv <= 0.2 ? 'high' : winner.group.health.finalPopulation.cv <= 0.35 ? 'medium' : 'low',
    },
    whyInteresting: [
      `best candidate for ${presetType} objective`,
      `score median ${winner.group.scores.groupedDefaultCandidateScoreMedian} with population median ${winner.group.health.finalPopulation.median}`,
    ],
  };
}

function getMostCommonGroupSize(groups: GroupAggregate[]): number {
  if (groups.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const group of groups) {
    const size = group.runs.length;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return ranked[0][0];
}

function buildParameterSignals(groups: AnalysisSummaryCandidate[]): AnalysisSummary['parameterSignals']['directional'] {
  if (groups.length < 3) return [];
  const keys = Object.keys(groups[0].settings)
    .filter(key => groups.every(group => typeof group.settings[key] === 'number'))
    .sort((a, b) => a.localeCompare(b));

  return keys.map(parameter => {
    const x = groups.map(group => Number(group.settings[parameter]));
    const populationY = groups.map(group => group.health.finalPopulation.median);
    const diversityY = groups.map(group => group.health.genomeEntropy.median);
    const populationCorrelation = correlation(x, populationY);
    const diversityCorrelation = correlation(x, diversityY);

    const toTrend = (value: number): 'up' | 'down' | 'mixed' => {
      if (value >= 0.15) return 'up';
      if (value <= -0.15) return 'down';
      return 'mixed';
    };

    const strengthScore = Math.max(Math.abs(populationCorrelation), Math.abs(diversityCorrelation));
    const strength: 'weak' | 'moderate' | 'strong' =
      strengthScore >= 0.55 ? 'strong' : strengthScore >= 0.3 ? 'moderate' : 'weak';

    return {
      parameter,
      populationTrend: toTrend(populationCorrelation),
      diversityTrend: toTrend(diversityCorrelation),
      strength,
    };
  });
}

export function generateAnalysisSummary(results: RunAnalysis[], options: AnalysisSummaryOptions = {}): AnalysisSummary {
  const runs = buildRuns(results);
  const groups = buildGroups(runs);
  const sourceGroupsById = new Map(groups.map(group => [group.candidateId, group]));
  const candidates = groups
    .map(group => asCandidate(group))
    .sort((a, b) => b.scores.groupedDefaultCandidateScoreMedian - a.scores.groupedDefaultCandidateScoreMedian || a.candidateId.localeCompare(b.candidateId));

  const finalPopValues = runs.map(run => run.finalCensus?.population ?? 0);
  const entropyValues = runs.map(run => run.finalCensus?.genomeEntropy ?? 0);
  const defaultScoreValues = runs.map(run => run.defaultCandidateScore);
  const collapsedRuns = runs.filter(run => run.collapseEvent).length;
  const survivingRuns = runs.length - collapsedRuns;

  const runAnalysisInputs: RunAnalysis[] = runs.map(run => ({
    runId: run.runId,
    settings: run.settings,
    finalCensus: run.finalCensus,
    censusData: run.censusData,
    summary: {
      finalPopulation: run.finalCensus?.population ?? 0,
      peakPopulation: 0,
      meanDiversity: 0,
      collapseEvent: run.collapseEvent,
    },
  }));

  const sensitivityAnalysis = analyzeSensitivity(runAnalysisInputs, ['defaultCandidateScore', 'finalPopulation', 'genomeEntropy']);

  const presetTypes: InterestingPresetType[] = [
    'high_combat',
    'mobile_swarm',
    'producer_garden',
    'defender_fortress',
    'complexity',
    'spatial_dynamic',
  ];

  const interestingPresets: AnalysisSummaryInterestingPreset[] = [];
  const usedInterestingCandidateIds = new Set<string>();
  for (const presetType of presetTypes) {
    const selected = selectInterestingPreset(candidates, sourceGroupsById, presetType, usedInterestingCandidateIds);
    if (!selected) {
      continue;
    }
    usedInterestingCandidateIds.add(selected.candidateId);
    interestingPresets.push(selected);
    if (interestingPresets.length >= (options.topInterestingPresets ?? 6)) {
      break;
    }
  }

  return {
    schemaVersion: '1.0.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      presetName: options.presetName ?? 'unknown',
      totalRuns: runs.length,
      settingsGroups: groups.length,
      repeatsPerGroup: getMostCommonGroupSize(groups),
      durationSec: options.durationSec ?? 0,
    },
    datasetOverview: {
      survival: {
        survivingRuns,
        collapsedRuns,
        collapseRate: trunc(runs.length > 0 ? collapsedRuns / runs.length : 0),
      },
      qualityDistribution: {
        finalPopulation: {
          min: trunc(minOrZero(finalPopValues)),
          p25: trunc(percentile(finalPopValues, 25)),
          median: trunc(percentile(finalPopValues, 50)),
          p75: trunc(percentile(finalPopValues, 75)),
          max: trunc(maxOrZero(finalPopValues)),
        },
        genomeEntropy: {
          min: trunc(minOrZero(entropyValues)),
          p25: trunc(percentile(entropyValues, 25)),
          median: trunc(percentile(entropyValues, 50)),
          p75: trunc(percentile(entropyValues, 75)),
          max: trunc(maxOrZero(entropyValues)),
        },
        defaultCandidateScore: {
          min: trunc(minOrZero(defaultScoreValues)),
          p25: trunc(percentile(defaultScoreValues, 25)),
          median: trunc(percentile(defaultScoreValues, 50)),
          p75: trunc(percentile(defaultScoreValues, 75)),
          max: trunc(maxOrZero(defaultScoreValues)),
        },
      },
    },
    defaultCandidates: {
      top10: candidates.slice(0, 10),
    },
    interestingPresets,
    parameterSignals: {
      directional: buildParameterSignals(candidates),
      warnings: [
        'directional trends are descriptive and not causal',
        'continuous Sobol value grouping can reduce apparent monotonicity',
      ],
    },
    sensitivityAnalysis,
    notes: {
      schemaQuirks: [
        'defaultCandidateScoreBySettings uses candidate settings hash ids',
      ],
      analysisLimits: [
        'summary compresses run-level detail and should be paired with full exports for deep debugging',
      ],
      nextActions: [
        'retest top 2-3 candidates with higher repeat count',
        'run one holdout profile before promoting defaults',
      ],
    },
  };
}

export function buildRunAnalysis(results: ExperimentResult[]): RunAnalysis[] {
  return results.map(result => {
    const censusData = result.censusData ?? [];
    const finalCensus = getFinalCensus(censusData) ?? result.finalCensus ?? null;
    return {
      runId: result.id,
      settings: result.settings as Record<string, unknown>,
      finalCensus,
      censusData,
      summary: {
        finalPopulation: result.summary.finalPopulation,
        peakPopulation: result.summary.peakPopulation,
        meanDiversity: result.summary.meanDiversity,
        collapseEvent: result.summary.collapseEvent,
      },
    };
  });
}
