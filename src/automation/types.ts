import { Config, SegmentType, SymmetryMode, PhaseMode } from '../types';

export interface AutomationExperimentSettings extends Partial<Config> {
  automationStepDtSec?: number;
  initialRandomSeedPerRunStep?: number;
  evolutionRandomSeedPerRunStep?: number;
  enabledSegmentTypes?: SegmentType[];
}

export interface AutomationPreset {
  name: string;
  description: string;
  samplingSummary?: string;
  usesSobolSampling?: boolean;
  durationSec: number;
  censusIntervalSec: number;
  screenshotIntervalSec: number;
  generateMosaic: boolean;
  sameRunCount: number;
  parameterSets: AutomationExperimentSettings[];
}

export interface ExperimentConfig {
  id: string;
  settings: AutomationExperimentSettings;
  presetName: string;
  durationSec: number;
  censusIntervalSec: number;
  screenshotIntervalSec: number;
  settingsGroupIndex: number;
  repeatIndex: number;
  repeatCount: number;
}

export interface CensusData {
  runId: string;
  settingsHash: string;
  timeSec: number;
  population: number;
  generationMax: number;
  generationMean: number;
  ageMinMs: number;
  ageMaxMs: number;
  ageMedianMs: number;
  ageQ1Ms: number;
  ageQ3Ms: number;
  totalDeaths: number;
  totalBirths: number;
  birthsByReproduction: number;
  birthsBySpawning: number;
  deathsByStarvation: number;
  deathsByOldAge: number;
  deathsByAttack: number;
  deathsByCulling: number;
  uniqueGenomes: number;
  genomeEntropy: number;
  dominantGenomeFreq: number;
  segmentCounts: Record<SegmentType, number>;
  segmentPercentages: Record<SegmentType, number>;
  meanSegmentsPerEntity: number;
  segmentDiversity: number;
  symmetryDistribution: Record<number, number>;
  symmetryModeDistribution: Record<SymmetryMode, number>;
  meanTotalLength: number;
  limbGroupDistribution: Record<number, number>;
  phaseModeDistribution: Record<PhaseMode, number>;
  meanHp: number;
  meanHpPercent: number;
  meanFood: number;
  meanFoodPercent: number;
  meanRepro: number;
  meanReproPercent: number;
  starvingCount: number;
  readyToReproduceCount: number;
  mobileCount: number;
  predatorCount: number;
  producerCount: number;
  defenderCount: number;
  hybridCounts: number;
  dedicatedMobileCount: number;
  dedicatedPredatorCount: number;
  dedicatedProducerCount: number;
  dedicatedDefenderCount: number;
  coverageRatio: number;
  meanNearestNeighbor: number;
  densityVariance: number;
}

export interface ExperimentResult {
  id: string;
  settings: AutomationExperimentSettings;
  settingsHash?: string;
  settingsGroupIndex?: number;
  repeatIndex?: number;
  repeatCount?: number;
  presetName?: string;
  durationSec?: number;
  censusIntervalSec?: number;
  summary: {
    finalPopulation: number;
    peakPopulation: number;
    minPopulation: number;
    meanDiversity: number;
    collapseEvent: boolean;
    collapseTimeSec: number | null;
    censuses: number;
  };
  finalCensus?: CensusData | null;
  censusData: CensusData[];
}

export interface ProgressInfo {
  running: boolean;
  currentIndex: number;
  totalExperiments: number;
  currentExperimentTimeSec: number;
  currentExperimentDurationSec: number;
  currentPopulation: number;
  currentGeneration: number;
  automationDtSec: number;
  completedResults: ExperimentResult[];
  presetName: string;
  startTimeMs: number;
}

export interface ScreenshotData {
  experimentId: string;
  timeSec: number;
  settings: AutomationExperimentSettings;
  population: number;
  generation: number;
  imageData: string;
  width: number;
  height: number;
  variedSettings: Record<string, number>;
  isFinal: boolean;
}

export interface MosaicConfig {
  maxColumns: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  padding: number;
  headerHeight: number;
  cellLabelHeight: number;
  backgroundColor: string;
  labelColor: string;
  fontSize: number;
}

export const DEFAULT_MOSAIC_CONFIG: MosaicConfig = {
  maxColumns: 4,
  thumbnailWidth: 300,
  thumbnailHeight: 300,
  padding: 4,
  headerHeight: 60,
  cellLabelHeight: 50,
  backgroundColor: '#1a1a2e',
  labelColor: '#ffffff',
  fontSize: 10,
};

export type AutomationStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface DownloadProgressInfo {
  active: boolean;
  current: number;
  total: number;
  stage: string;
}
