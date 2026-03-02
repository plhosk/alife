import { Config, DEFAULT_CONFIG } from '../types';
import { getAutomationDefaultRanges } from '../configSliders';
import { AutomationExperimentSettings, AutomationPreset, ExperimentConfig } from './types';
import * as lobos from 'lobos';

interface ParameterRange {
  min: number;
  max: number;
  round?: boolean;
  samplingExponent?: number;
  quantizeStep?: number;
}

type ParameterSpec = ParameterRange | unknown[];

const DEFAULT_RANGES: Record<string, ParameterSpec> = getAutomationDefaultRanges();

function isRange(spec: ParameterSpec): spec is ParameterRange {
  return typeof spec === 'object' && spec !== null && 'min' in spec && 'max' in spec;
}

function isObjectArray(arr: unknown[]): arr is Record<string, unknown>[] {
  return arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null && !('min' in arr[0] && 'max' in arr[0]);
}

function applySamplingExponent(sample: number, exponent?: number): number {
  const clampedSample = Math.min(1, Math.max(0, sample));
  if (exponent === undefined) return clampedSample;
  if (!Number.isFinite(exponent) || exponent <= 0 || exponent === 1) return clampedSample;
  return Math.pow(clampedSample, exponent);
}

function quantizeToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export interface SobolSearchOptions {
  count: number;
  includeDefaultRanges?: boolean;
  settings?: Record<string, ParameterSpec>;
}

export function generateSobolParameterSets(options: SobolSearchOptions): Partial<Config>[] {
  const { count, includeDefaultRanges = true, settings = {} } = options;
  const allSettings = includeDefaultRanges
    ? { ...DEFAULT_RANGES, ...settings }
    : { ...settings };
  const keys = Object.keys(allSettings);
  if (keys.length === 0 || count <= 0) {
    return [];
  }
  const dimensions = keys.length;
  const sequence = new lobos.Sobol(dimensions, { params: 'new-joe-kuo-6.1000', resolution: 32 });
  const samples = sequence.take(count);

  return samples.map(sample => {
    const config: Partial<Config> = {};

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const spec = allSettings[key];
      const sobolValue = sample[i];

      if (isRange(spec)) {
        const adjustedSample = applySamplingExponent(sobolValue, spec.samplingExponent);
        let value = spec.min + adjustedSample * (spec.max - spec.min);
        if (spec.quantizeStep) {
          value = quantizeToStep(value, spec.quantizeStep);
        }
        if (spec.round) {
          value = Math.round(value);
        }
        (config as Record<string, unknown>)[key] = value;
      } else {
        const idx = Math.min(spec.length - 1, Math.floor(sobolValue * spec.length));
        const selected = spec[idx];
        if (isObjectArray(spec)) {
          Object.assign(config, selected);
        } else {
          (config as Record<string, unknown>)[key] = selected;
        }
      }
    }

    return config;
  });
}

function getModularShardChunk<T>(values: T[], shardIndex: number, shardCount: number): T[] {
  const safeShardCount = Math.max(1, shardCount);
  const result: T[] = [];
  for (let i = shardIndex; i < values.length; i += safeShardCount) {
    result.push(values[i]);
  }
  return result;
}

const ECOSYSTEM_AXES_12D_DESCRIPTION = 'Default-centered Sobol sweep across photosynth, locomotor, combat, and environment axes at max population';
const ECOSYSTEM_AXES_12D_DURATION_SEC = 1200;
const ECOSYSTEM_AXES_12D_CENSUS_INTERVAL_SEC = 60;
const ECOSYSTEM_AXES_12D_SCREENSHOT_INTERVAL_SEC = 300;
const ECOSYSTEM_AXES_12D_REPEAT_COUNT = 3;
const ECOSYSTEM_AXES_12D_SOBOL_COUNT = 64;
const ECOSYSTEM_AXES_12D_SHARD_COUNT = 6;
const ECOSYSTEM_AXES_12D_INITIAL_SEED = 1000003;
const ECOSYSTEM_AXES_12D_EVOLUTION_SEED = 2000003;

const ECOSYSTEM_AXES_12D_SETTINGS: Record<string, ParameterSpec> = {
  photosynthesisRate: { min: 0, max: 14, quantizeStep: 0.1 },
  environmentNutrientPhotosynthMinMultiplier: { min: 0, max: 1, quantizeStep: 0.01 },
  environmentNutrientConsumptionRate: { min: 0, max: 3, samplingExponent: 1.5, quantizeStep: 0.025 },
  locomotorFoodCost: { min: 0, max: 0.01, samplingExponent: 1.5, quantizeStep: 0.0001 },
  impulseNutrientDemandRate: { min: 0, max: 0.01, samplingExponent: 2, quantizeStep: 0.0002 },
  environmentLocomotorNutrientToFoodScale: { min: 0, max: 30, quantizeStep: 0.25 },
  attackDamagePerLength: { min: 0, max: 20, samplingExponent: 1.5, quantizeStep: 0.2 },
  foodStealPerDamage: { min: 0, max: 5, samplingExponent: 1.5, quantizeStep: 0.1 },
  locomotorImpulsePerLength: { min: 0, max: 280, samplingExponent: 2, quantizeStep: 2 },
  environmentNutrientRegenRate: { min: 0, max: 1, samplingExponent: 2.5, quantizeStep: 0.01 },
  environmentFootprintScale: { min: 0.1, max: 2.5, quantizeStep: 0.05 },
};

const ECOSYSTEM_AXES_12D_ANCHORS: Partial<Config>[] = [
  {
    photosynthesisRate: DEFAULT_CONFIG.photosynthesisRate,
    environmentNutrientPhotosynthMinMultiplier: DEFAULT_CONFIG.environmentNutrientPhotosynthMinMultiplier,
    environmentNutrientConsumptionRate: DEFAULT_CONFIG.environmentNutrientConsumptionRate,
    locomotorFoodCost: DEFAULT_CONFIG.locomotorFoodCost,
    impulseNutrientDemandRate: DEFAULT_CONFIG.impulseNutrientDemandRate,
    environmentLocomotorNutrientToFoodScale: DEFAULT_CONFIG.environmentLocomotorNutrientToFoodScale,
    attackDamagePerLength: DEFAULT_CONFIG.attackDamagePerLength,
    foodStealPerDamage: DEFAULT_CONFIG.foodStealPerDamage,
    locomotorImpulsePerLength: DEFAULT_CONFIG.locomotorImpulsePerLength,
    environmentNutrientRegenRate: DEFAULT_CONFIG.environmentNutrientRegenRate,
    environmentFootprintScale: DEFAULT_CONFIG.environmentFootprintScale,
  },
];

const ECOSYSTEM_AXES_12D_SOBOL: Partial<Config>[] = generateSobolParameterSets({
  count: ECOSYSTEM_AXES_12D_SOBOL_COUNT,
  includeDefaultRanges: false,
  settings: ECOSYSTEM_AXES_12D_SETTINGS,
});

const ECOSYSTEM_AXES_12D_ALL_PARAMETER_SETS: Partial<Config>[] = [
  ...ECOSYSTEM_AXES_12D_ANCHORS,
  ...ECOSYSTEM_AXES_12D_SOBOL,
];

function applyEcosystemAxes12DStageOneSeeding(parameterSets: Partial<Config>[]): AutomationExperimentSettings[] {
  return parameterSets.map((parameterSet) => {
    return {
      ...parameterSet,
      initialRandomSeed: ECOSYSTEM_AXES_12D_INITIAL_SEED,
      initialRandomSeedPerRunStep: 0,
      evolutionRandomSeed: ECOSYSTEM_AXES_12D_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    };
  });
}

function createEcosystemAxes12DPreset(name: string, anchors: Partial<Config>[], sobol: Partial<Config>[]): AutomationPreset {
  const stageOneSeededParameterSets = applyEcosystemAxes12DStageOneSeeding([...anchors, ...sobol]);

  return {
    name,
    description: ECOSYSTEM_AXES_12D_DESCRIPTION,
    samplingSummary: `${anchors.length} anchors + ${sobol.length} Sobol over 12 ecosystem axes (x${ECOSYSTEM_AXES_12D_REPEAT_COUNT} repeats)`,
    usesSobolSampling: true,
    durationSec: ECOSYSTEM_AXES_12D_DURATION_SEC,
    censusIntervalSec: ECOSYSTEM_AXES_12D_CENSUS_INTERVAL_SEC,
    screenshotIntervalSec: ECOSYSTEM_AXES_12D_SCREENSHOT_INTERVAL_SEC,
    generateMosaic: true,
    sameRunCount: ECOSYSTEM_AXES_12D_REPEAT_COUNT,
    parameterSets: stageOneSeededParameterSets,
  };
}

function createEcosystemAxes12DShardPreset(shardLabel: string, shardIndex: number): AutomationPreset {
  const parameterSets = applyEcosystemAxes12DStageOneSeeding(
    getModularShardChunk(ECOSYSTEM_AXES_12D_ALL_PARAMETER_SETS, shardIndex, ECOSYSTEM_AXES_12D_SHARD_COUNT)
  );

  return {
    name: `Ecosystem Axes Sobol 12D (Shard ${shardLabel})`,
    description: ECOSYSTEM_AXES_12D_DESCRIPTION,
    samplingSummary: `${parameterSets.length} modular-sharded points from 12D set`,
    usesSobolSampling: true,
    durationSec: ECOSYSTEM_AXES_12D_DURATION_SEC,
    censusIntervalSec: ECOSYSTEM_AXES_12D_CENSUS_INTERVAL_SEC,
    screenshotIntervalSec: ECOSYSTEM_AXES_12D_SCREENSHOT_INTERVAL_SEC,
    generateMosaic: true,
    sameRunCount: ECOSYSTEM_AXES_12D_REPEAT_COUNT,
    parameterSets,
  };
}

export const ECOSYSTEM_AXES_12D: AutomationPreset = createEcosystemAxes12DPreset(
  'Ecosystem Axes Sobol (12 Dimensions)',
  ECOSYSTEM_AXES_12D_ANCHORS,
  ECOSYSTEM_AXES_12D_SOBOL
);

export const ECOSYSTEM_AXES_12D_SHARD_A: AutomationPreset = createEcosystemAxes12DShardPreset('A', 0);
export const ECOSYSTEM_AXES_12D_SHARD_B: AutomationPreset = createEcosystemAxes12DShardPreset('B', 1);
export const ECOSYSTEM_AXES_12D_SHARD_C: AutomationPreset = createEcosystemAxes12DShardPreset('C', 2);
export const ECOSYSTEM_AXES_12D_SHARD_D: AutomationPreset = createEcosystemAxes12DShardPreset('D', 3);
export const ECOSYSTEM_AXES_12D_SHARD_E: AutomationPreset = createEcosystemAxes12DShardPreset('E', 4);
export const ECOSYSTEM_AXES_12D_SHARD_F: AutomationPreset = createEcosystemAxes12DShardPreset('F', 5);

export const SOBOL_SEARCH: AutomationPreset = {
  name: 'All-Slider Exploration (High-D)',
  description: 'High-dimensional Sobol sweep for broad discovery and regression smoke checks',
  samplingSummary: '64 Sobol over full slider space',
  usesSobolSampling: true,
  durationSec: 1200,
  censusIntervalSec: 60,
  screenshotIntervalSec: 300,
  generateMosaic: true,
  sameRunCount: 2,
  parameterSets: generateSobolParameterSets({
    count: 64,
  }),
};

const AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED = 3100001;
const AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED = 4100001;

export const PHOTOSYNTHESIS_SWEEP: AutomationPreset = {
  name: 'Photosynthesis Sweep',
  description: 'Single-axis sweep of photosynthesis rate',
  samplingSummary: '7 values × 3 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 3,
  parameterSets: [
    { photosynthesisRate: 0 },
    { photosynthesisRate: 2 },
    { photosynthesisRate: 4 },
    { photosynthesisRate: 6 },
    { photosynthesisRate: 8 },
    { photosynthesisRate: 10 },
    { photosynthesisRate: 14 },
  ],
};

export const COMBAT_BALANCE_GRID: AutomationPreset = {
  name: 'Combat Balance Grid',
  description: '2D sweep of attack damage vs food steal to find predator viability',
  samplingSummary: '4×4 grid = 16 points × 2 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 2,
  parameterSets: [
    { attackDamagePerLength: 0, foodStealPerDamage: 0 },
    { attackDamagePerLength: 0, foodStealPerDamage: 1.4 },
    { attackDamagePerLength: 0, foodStealPerDamage: 3 },
    { attackDamagePerLength: 0, foodStealPerDamage: 5 },
    { attackDamagePerLength: 5, foodStealPerDamage: 0 },
    { attackDamagePerLength: 5, foodStealPerDamage: 1.4 },
    { attackDamagePerLength: 5, foodStealPerDamage: 3 },
    { attackDamagePerLength: 5, foodStealPerDamage: 5 },
    { attackDamagePerLength: 10, foodStealPerDamage: 0 },
    { attackDamagePerLength: 10, foodStealPerDamage: 1.4 },
    { attackDamagePerLength: 10, foodStealPerDamage: 3 },
    { attackDamagePerLength: 10, foodStealPerDamage: 5 },
    { attackDamagePerLength: 20, foodStealPerDamage: 0 },
    { attackDamagePerLength: 20, foodStealPerDamage: 1.4 },
    { attackDamagePerLength: 20, foodStealPerDamage: 3 },
    { attackDamagePerLength: 20, foodStealPerDamage: 5 },
  ],
};

export const MUTATION_PRESSURE: AutomationPreset = {
  name: 'Mutation Pressure',
  description: 'Single-axis sweep of mutation rate',
  samplingSummary: '6 values × 3 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 3,
  parameterSets: [
    { mutationRate: 0.01 },
    { mutationRate: 0.05 },
    { mutationRate: 0.10 },
    { mutationRate: 0.15 },
    { mutationRate: 0.25 },
    { mutationRate: 0.40 },
  ],
};

export const LOCOMOTION_COST_SWEEP: AutomationPreset = {
  name: 'Locomotion Cost Sweep',
  description: 'Paired sweep of locomotor impulse vs food cost',
  samplingSummary: '5 paired values × 3 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 3,
  parameterSets: [
    { locomotorImpulsePerLength: 50, locomotorFoodCost: 0.0002 },
    { locomotorImpulsePerLength: 100, locomotorFoodCost: 0.0005 },
    { locomotorImpulsePerLength: 150, locomotorFoodCost: 0.001 },
    { locomotorImpulsePerLength: 200, locomotorFoodCost: 0.002 },
    { locomotorImpulsePerLength: 280, locomotorFoodCost: 0.005 },
  ],
};

export const ENVIRONMENT_PRODUCTIVITY: AutomationPreset = {
  name: 'Environment Productivity',
  description: '2D grid of nutrient regen vs consumption',
  samplingSummary: '4×4 grid = 16 points × 2 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 2,
  parameterSets: [
    { environmentNutrientRegenRate: 0.1, environmentNutrientConsumptionRate: 0.3 },
    { environmentNutrientRegenRate: 0.1, environmentNutrientConsumptionRate: 1.0 },
    { environmentNutrientRegenRate: 0.1, environmentNutrientConsumptionRate: 2.0 },
    { environmentNutrientRegenRate: 0.1, environmentNutrientConsumptionRate: 3.0 },
    { environmentNutrientRegenRate: 0.3, environmentNutrientConsumptionRate: 0.3 },
    { environmentNutrientRegenRate: 0.3, environmentNutrientConsumptionRate: 1.0 },
    { environmentNutrientRegenRate: 0.3, environmentNutrientConsumptionRate: 2.0 },
    { environmentNutrientRegenRate: 0.3, environmentNutrientConsumptionRate: 3.0 },
    { environmentNutrientRegenRate: 0.6, environmentNutrientConsumptionRate: 0.3 },
    { environmentNutrientRegenRate: 0.6, environmentNutrientConsumptionRate: 1.0 },
    { environmentNutrientRegenRate: 0.6, environmentNutrientConsumptionRate: 2.0 },
    { environmentNutrientRegenRate: 0.6, environmentNutrientConsumptionRate: 3.0 },
    { environmentNutrientRegenRate: 1.0, environmentNutrientConsumptionRate: 0.3 },
    { environmentNutrientRegenRate: 1.0, environmentNutrientConsumptionRate: 1.0 },
    { environmentNutrientRegenRate: 1.0, environmentNutrientConsumptionRate: 2.0 },
    { environmentNutrientRegenRate: 1.0, environmentNutrientConsumptionRate: 3.0 },
  ],
};

export const PRODUCER_PREDATOR_BALANCE: AutomationPreset = {
  name: 'Producer-Predator Balance',
  description: '2D grid exploring ecosystem role viability',
  samplingSummary: '4×4 grid = 16 points × 2 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 2,
  parameterSets: [
    { photosynthesisRate: 0, attackDamagePerLength: 0 },
    { photosynthesisRate: 0, attackDamagePerLength: 5 },
    { photosynthesisRate: 0, attackDamagePerLength: 10 },
    { photosynthesisRate: 0, attackDamagePerLength: 20 },
    { photosynthesisRate: 4, attackDamagePerLength: 0 },
    { photosynthesisRate: 4, attackDamagePerLength: 5 },
    { photosynthesisRate: 4, attackDamagePerLength: 10 },
    { photosynthesisRate: 4, attackDamagePerLength: 20 },
    { photosynthesisRate: 8, attackDamagePerLength: 0 },
    { photosynthesisRate: 8, attackDamagePerLength: 5 },
    { photosynthesisRate: 8, attackDamagePerLength: 10 },
    { photosynthesisRate: 8, attackDamagePerLength: 20 },
    { photosynthesisRate: 14, attackDamagePerLength: 0 },
    { photosynthesisRate: 14, attackDamagePerLength: 5 },
    { photosynthesisRate: 14, attackDamagePerLength: 10 },
    { photosynthesisRate: 14, attackDamagePerLength: 20 },
  ],
};

export const POPULATION_CAP_SWEEP: AutomationPreset = {
  name: 'Population Cap Sweep',
  description: 'Single-axis sweep of max population',
  samplingSummary: '6 values × 3 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 3,
  parameterSets: [
    { maxPopulation: 100 },
    { maxPopulation: 250 },
    { maxPopulation: 500 },
    { maxPopulation: 750 },
    { maxPopulation: 1500 },
    { maxPopulation: 2500 },
  ],
};

export const METABOLISM_PRESSURE: AutomationPreset = {
  name: 'Metabolism Pressure',
  description: '2D grid of per-segment vs per-length metabolism',
  samplingSummary: '4×4 grid = 16 points × 2 repeats',
  durationSec: 600,
  censusIntervalSec: 60,
  screenshotIntervalSec: 200,
  generateMosaic: true,
  sameRunCount: 2,
  parameterSets: [
    { metabolismPerSegment: 0, metabolismPerLength: 0 },
    { metabolismPerSegment: 0, metabolismPerLength: 0.05 },
    { metabolismPerSegment: 0, metabolismPerLength: 0.15 },
    { metabolismPerSegment: 0, metabolismPerLength: 0.30 },
    { metabolismPerSegment: 0.05, metabolismPerLength: 0 },
    { metabolismPerSegment: 0.05, metabolismPerLength: 0.05 },
    { metabolismPerSegment: 0.05, metabolismPerLength: 0.15 },
    { metabolismPerSegment: 0.05, metabolismPerLength: 0.30 },
    { metabolismPerSegment: 0.10, metabolismPerLength: 0 },
    { metabolismPerSegment: 0.10, metabolismPerLength: 0.05 },
    { metabolismPerSegment: 0.10, metabolismPerLength: 0.15 },
    { metabolismPerSegment: 0.10, metabolismPerLength: 0.30 },
    { metabolismPerSegment: 0.20, metabolismPerLength: 0 },
    { metabolismPerSegment: 0.20, metabolismPerLength: 0.05 },
    { metabolismPerSegment: 0.20, metabolismPerLength: 0.15 },
    { metabolismPerSegment: 0.20, metabolismPerLength: 0.30 },
  ],
};

export const AUTOMATION_STEP_DT_SWEEP: AutomationPreset = {
  name: 'Automation Step DT Sweep',
  description: 'A/B sweep of automation step dt to measure result drift versus the 1/60s baseline',
  samplingSummary: 'Grid 5 values (0.0167, 0.0208, 0.0333, 0.0500, 0.0667) with paired-seed repeats',
  durationSec: 1200,
  censusIntervalSec: 60,
  screenshotIntervalSec: 300,
  generateMosaic: true,
  sameRunCount: 4,
  parameterSets: [
    {
      automationStepDtSec: 1 / 60,
      initialRandomSeed: AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED,
      initialRandomSeedPerRunStep: 1,
      evolutionRandomSeed: AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    },
    {
      automationStepDtSec: 1 / 48,
      initialRandomSeed: AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED,
      initialRandomSeedPerRunStep: 1,
      evolutionRandomSeed: AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    },
    {
      automationStepDtSec: 1 / 30,
      initialRandomSeed: AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED,
      initialRandomSeedPerRunStep: 1,
      evolutionRandomSeed: AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    },
    {
      automationStepDtSec: 1 / 20,
      initialRandomSeed: AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED,
      initialRandomSeedPerRunStep: 1,
      evolutionRandomSeed: AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    },
    {
      automationStepDtSec: 1 / 15,
      initialRandomSeed: AUTOMATION_STEP_DT_SWEEP_INITIAL_SEED,
      initialRandomSeedPerRunStep: 1,
      evolutionRandomSeed: AUTOMATION_STEP_DT_SWEEP_EVOLUTION_SEED,
      evolutionRandomSeedPerRunStep: 1,
    },
  ],
};

export const PRESETS: AutomationPreset[] = [
  PHOTOSYNTHESIS_SWEEP,
  COMBAT_BALANCE_GRID,
  MUTATION_PRESSURE,
  LOCOMOTION_COST_SWEEP,
  ENVIRONMENT_PRODUCTIVITY,
  PRODUCER_PREDATOR_BALANCE,
  POPULATION_CAP_SWEEP,
  METABOLISM_PRESSURE,
  ECOSYSTEM_AXES_12D,
  ECOSYSTEM_AXES_12D_SHARD_A,
  ECOSYSTEM_AXES_12D_SHARD_B,
  ECOSYSTEM_AXES_12D_SHARD_C,
  ECOSYSTEM_AXES_12D_SHARD_D,
  ECOSYSTEM_AXES_12D_SHARD_E,
  ECOSYSTEM_AXES_12D_SHARD_F,
  SOBOL_SEARCH,
  AUTOMATION_STEP_DT_SWEEP,
];

function resolveExperimentSettings(settings: AutomationExperimentSettings, repeatIndex: number): AutomationExperimentSettings {
  const {
    initialRandomSeedPerRunStep,
    evolutionRandomSeedPerRunStep,
    ...baseSettings
  } = settings;
  const resolvedSettings: AutomationExperimentSettings = { ...baseSettings };

  const applySteppedSeed = (
    baseSeed: number | null | undefined,
    perRunStep: number | undefined,
  ): number | null => {
    const hasBaseSeed = typeof baseSeed === 'number' && Number.isFinite(baseSeed);
    const hasPerRunStep = typeof perRunStep === 'number' && Number.isFinite(perRunStep);
    if (!hasBaseSeed && !hasPerRunStep) {
      return null;
    }

    let seed = hasBaseSeed ? baseSeed : 0;
    if (hasPerRunStep) {
      seed += repeatIndex * perRunStep;
    }
    return Math.trunc(seed) >>> 0;
  };

  const initialSeed = applySteppedSeed(resolvedSettings.initialRandomSeed, initialRandomSeedPerRunStep);
  if (initialSeed !== null) {
    resolvedSettings.initialRandomSeed = initialSeed;
  }

  const evolutionSeed = applySteppedSeed(resolvedSettings.evolutionRandomSeed, evolutionRandomSeedPerRunStep);
  if (evolutionSeed !== null) {
    resolvedSettings.evolutionRandomSeed = evolutionSeed;
  }

  return resolvedSettings;
}

export function createExperimentConfigs(preset: AutomationPreset): ExperimentConfig[] {
  const sameRunCount = Math.max(1, preset.sameRunCount ?? 1);
  const configs: ExperimentConfig[] = [];
  let expIndex = 0;

  for (let paramIndex = 0; paramIndex < preset.parameterSets.length; paramIndex++) {
    const settings = preset.parameterSets[paramIndex];

    for (let run = 0; run < sameRunCount; run++) {
      expIndex++;
      const resolvedSettings = resolveExperimentSettings(settings, run);
      configs.push({
        id: `exp-${String(expIndex).padStart(3, '0')}`,
        settings: resolvedSettings,
        presetName: preset.name,
        durationSec: preset.durationSec,
        censusIntervalSec: preset.censusIntervalSec,
        screenshotIntervalSec: preset.screenshotIntervalSec,
        settingsGroupIndex: paramIndex,
        repeatIndex: run,
        repeatCount: sameRunCount,
      });
    }
  }

  return configs;
}

export function getVariedParameters(preset: AutomationPreset): string[] {
  const varied: string[] = [];
  const firstSet = preset.parameterSets[0];
  if (!firstSet) return varied;

  for (const key of Object.keys(firstSet)) {
    const values = new Set(preset.parameterSets.map(s => s[key as keyof Config]));
    if (values.size > 1) {
      varied.push(key);
    }
  }
  return varied;
}

export function formatParameterName(key: string): string {
  if (key === 'automationStepDtSec') {
    return 'step time (ms)';
  }
  if (key === 'initialRandomSeed') {
    return 'initial seed';
  }
  if (key === 'initialRandomSeedPerRunStep') {
    return 'initial seed/run';
  }
  if (key === 'evolutionRandomSeed') {
    return 'evolution seed';
  }
  if (key === 'evolutionRandomSeedPerRunStep') {
    return 'evolution seed/run';
  }
  return key;
}

export function formatParameterValue(key: string, value: number): string {
  if (key === 'automationStepDtSec') {
    return (value * 1000).toFixed(1);
  }
  if (
    key === 'initialRandomSeed'
    || key === 'initialRandomSeedPerRunStep'
    || key === 'evolutionRandomSeed'
    || key === 'evolutionRandomSeedPerRunStep'
  ) {
    return Math.trunc(value).toString();
  }
  if (value === Math.floor(value)) {
    return value.toString();
  }
  if (Math.abs(value) < 0.01) {
    return value.toFixed(4);
  }
  if (Math.abs(value) < 1) {
    return value.toFixed(2);
  }
  return value.toFixed(1);
}

export function estimateTotalDuration(preset: AutomationPreset): number {
  const sameRunCount = Math.max(1, preset.sameRunCount ?? 1);
  return preset.parameterSets.length * sameRunCount * preset.durationSec;
}

export function formatDuration(durationSec: number): string {
  if (durationSec < 60) return `${durationSec}s`;
  if (durationSec < 3600) {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(durationSec / 3600);
  const mins = Math.floor((durationSec % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
