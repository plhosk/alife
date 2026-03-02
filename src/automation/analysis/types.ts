import { ExperimentResult, CensusData } from '../types';

export interface RunAnalysis {
  runId: string;
  settings: Record<string, unknown>;
  finalCensus: CensusData | null;
  censusData: CensusData[];
  summary: {
    finalPopulation: number;
    peakPopulation: number;
    meanDiversity: number;
    collapseEvent: boolean;
  };
  censusChange?: CensusChangeAnalysis;
}

export interface MetricRanking {
  metric: string;
  description: string;
  higherIsBetter: boolean;
  fields: ['runId', 'value'];
  runs: Array<[string, number]>;
}

export interface CategoryResult {
  category: string;
  description: string;
  fields: ['runId', 'score'];
  runs: Array<[string, number, ...unknown[]]>;
}

export interface AnalysisOutput {
  generatedAt: string;
  totalRuns: number;
  survivingRuns: number;
  collapsedRuns: number;
  rankings: MetricRanking[];
  categories: CategoryResult[];
  settingsImpact: SettingsImpactAnalysis[];
  correlations: CorrelationAnalysis[];
  censusChangeRankings: CensusChangeRanking[];
}

export interface AnalysisSummaryOptions {
  presetName?: string;
  durationSec?: number;
  generatedAt?: string;
  topDefaultCandidates?: number;
  topInterestingPresets?: number;
}

export interface MetricDistribution {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface SummaryStatRange {
  min: number;
  median: number;
  max: number;
}

export interface SummaryStatRangeWithCv extends SummaryStatRange {
  cv: number;
}

export interface AnalysisSummarySource {
  presetName: string;
  totalRuns: number;
  settingsGroups: number;
  repeatsPerGroup: number;
  durationSec: number;
}

export interface AnalysisSummaryDatasetOverview {
  survival: {
    survivingRuns: number;
    collapsedRuns: number;
    collapseRate: number;
  };
  qualityDistribution: {
    finalPopulation: MetricDistribution;
    genomeEntropy: MetricDistribution;
    defaultCandidateScore: MetricDistribution;
  };
}

export type SummaryConfidence = 'high' | 'medium' | 'low';
export type SummaryDecision = 'promote' | 'hold' | 'reject';

export interface SummaryRecommendation {
  candidateId: string;
  confidence: SummaryConfidence;
  why: string[];
}

export interface AnalysisSummaryCandidate {
  candidateId: string;
  runs: string[];
  settings: Record<string, unknown>;
  scores: {
    groupedDefaultCandidateScoreMean: number;
    groupedDefaultCandidateScoreMedian: number;
    runDefaultCandidateScore: SummaryStatRangeWithCv;
    segmentBalanceScore: SummaryStatRange;
    dedicatedRoleCoexistenceScore: SummaryStatRange;
    sustainedGrowthScore: SummaryStatRange;
    oscillationScore: SummaryStatRange;
    earlyPlateauPenalty: SummaryStatRange;
  };
  health: {
    finalPopulation: SummaryStatRangeWithCv;
    genomeEntropy: SummaryStatRange;
    roleCountsMin: {
      mobile: number;
      predator: number;
      producer: number;
      defender: number;
    };
    dedicatedRoleCountsMin: {
      mobile: number;
      predator: number;
      producer: number;
      defender: number;
    };
    cullingPressure: SummaryStatRange;
    populationSwingRatio: SummaryStatRange;
  };
  collapseRate: number;
  risks: string[];
  decision: SummaryDecision;
  confidence: SummaryConfidence;
}

export type InterestingPresetType =
  | 'high_combat'
  | 'mobile_swarm'
  | 'producer_garden'
  | 'defender_fortress'
  | 'complexity'
  | 'spatial_dynamic';

export interface AnalysisSummaryInterestingPreset {
  presetType: InterestingPresetType;
  candidateId: string;
  runs: string[];
  settings: Record<string, unknown>;
  evidence: {
    keyMetrics: Record<string, number>;
    comparativeRank: number;
  };
  viability: {
    collapseRate: number;
    repeatStability: SummaryConfidence;
  };
  whyInteresting: string[];
}

export interface AnalysisSummaryParameterSignal {
  parameter: string;
  populationTrend: 'up' | 'down' | 'mixed';
  diversityTrend: 'up' | 'down' | 'mixed';
  strength: 'weak' | 'moderate' | 'strong';
}

export interface SobolSensitivityIndices {
  firstOrder: Record<string, number>;
  totalOrder: Record<string, number>;
  warning?: string;
  parameterSignals?: Array<{
    parameter: string;
    correlation: number;
    trend: 'up' | 'down' | 'mixed';
    strength: 'weak' | 'moderate' | 'strong';
  }>;
}

export interface ParameterSensitivityRanking {
  parameter: string;
  avgTotalOrder: number;
  byMetric: Record<string, {
    firstOrder: number;
    totalOrder: number;
  }>;
}

export interface SensitivityAnalysisResult {
  metrics: Record<string, SobolSensitivityIndices>;
  ranking: ParameterSensitivityRanking[];
  parameterKeys: string[];
  sampleCount: number;
  warning?: string;
}

export interface AnalysisSummary {
  schemaVersion: '1.0.0';
  generatedAt: string;
  source: AnalysisSummarySource;
  datasetOverview: AnalysisSummaryDatasetOverview;
  defaultCandidates: {
    top10: AnalysisSummaryCandidate[];
  };
  interestingPresets: AnalysisSummaryInterestingPreset[];
  parameterSignals: {
    directional: AnalysisSummaryParameterSignal[];
    warnings: string[];
  };
  sensitivityAnalysis?: SensitivityAnalysisResult;
  notes: {
    schemaQuirks: string[];
    analysisLimits: string[];
    nextActions: string[];
  };
}

export interface SettingsImpactAnalysis {
  parameter: string;
  fields: ['value', 'avgPopulation', 'avgDiversity', 'avgDensityVariance', 'collapseRate'];
  impact: Array<[unknown, number, number, number, number]>;
}

export interface CorrelationAnalysis {
  metric1: string;
  metric2: string;
  coefficient: number;
  interpretation: string;
}

export interface MetricChange {
  metric: string;
  startValue: number;
  endValue: number;
  absoluteChange: number;
  percentChange: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  volatility: number;
}

export interface CensusChangeAnalysis {
  runId: string;
  timeSpanSec: number;
  censusCount: number;
  metricChanges: MetricChange[];
  overallChangeScore: number;
  stabilityScore: number;
  volatilityScore: number;
  dominantTrend: 'growth' | 'decline' | 'oscillation' | 'stable';
  keyInsights: string[];
}

export interface CensusChangeRanking {
  category: 'most_dynamic' | 'most_stable' | 'most_volatile' | 'trending_up' | 'trending_down' | 'oscillating';
  description: string;
  fields: ['runId', 'score'];
  runs: Array<[string, number]>;
}

export type { ExperimentResult, CensusData };
