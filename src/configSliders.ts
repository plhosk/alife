import resetIcon from './icons/reset.svg?raw';
import { Config, DEFAULT_CONFIG, SURVIVAL_CONSTANTS } from './types';

const MAX_AGE_UNLIMITED_MINUTES = SURVIVAL_CONSTANTS.maxAgeUnlimitedMs / 60000;

type NumericConfigKey = {
  [K in keyof Config]: Config[K] extends number ? K : never
}[keyof Config];

interface SliderAutomationOptions {
  enabled?: boolean;
  min?: number;
  max?: number;
  round?: boolean;
  samplingExponent?: number;
}

export interface SliderAutomationRange {
  min: number;
  max: number;
  round?: boolean;
  samplingExponent?: number;
}

export interface ConfigSliderDefinition {
  key: NumericConfigKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  readValue?: (config: Config) => number;
  applyValue?: (config: Config, value: number) => void;
  automation?: SliderAutomationOptions;
}

interface ConfigSliderCategory {
  label: string;
  description?: string;
  keys: NumericConfigKey[];
}

export interface RenderConfigSlidersOptions {
  getResetConfig?: () => Config;
}

export const CONFIG_SLIDERS: ConfigSliderDefinition[] = [
  {
    key: 'mutationRate',
    label: 'Mutation rate',
    min: 0,
    max: 0.5,
    step: 0.01,
    format: v => v.toFixed(2),
    automation: { samplingExponent: 2 },
  },
  { key: 'maxPopulation', label: 'Max population', min: 10, max: 3000, step: 10, automation: { round: true } },
  { key: 'baseMaxHp', label: 'Base max HP', min: 0, max: 120, step: 1, format: v => v.toFixed(0), automation: { round: true } },
  { key: 'hpPerWeightedLength', label: 'HP per weighted length', min: 0, max: 2, step: 0.05, format: v => v.toFixed(2) },
  { key: 'baseMaxFoodBuffer', label: 'Base max food buffer', min: 0, max: 80, step: 1, format: v => v.toFixed(0), automation: { round: true } },
  { key: 'foodBufferPerWeightedLength', label: 'Food per weighted length', min: 0, max: 2, step: 0.05, format: v => v.toFixed(2) },
  {
    key: 'maxAgeMs',
    label: 'Max age (minutes)',
    min: 0,
    max: MAX_AGE_UNLIMITED_MINUTES,
    step: 1,
    format: v => (v >= MAX_AGE_UNLIMITED_MINUTES ? 'Unlimited' : `${v.toFixed(0)}m`),
    readValue: config => {
      if (config.maxAgeMs >= SURVIVAL_CONSTANTS.maxAgeUnlimitedMs) {
        return MAX_AGE_UNLIMITED_MINUTES;
      }
      return config.maxAgeMs / 60000;
    },
    applyValue: (config, value) => {
      config.maxAgeMs = value >= MAX_AGE_UNLIMITED_MINUTES
        ? SURVIVAL_CONSTANTS.maxAgeUnlimitedMs
        : value * 60000;
    },
    automation: { enabled: false },
  },
  { key: 'photosynthesisRate', label: 'Photosynthesis rate', min: 0, max: 14, step: 0.1, format: v => v.toFixed(1) },
  { key: 'attackDamagePerLength', label: 'Attack damage per length', min: 0, max: 20, step: 0.2, format: v => v.toFixed(1), automation: { samplingExponent: 1.5 } },
  { key: 'foodStealPerDamage', label: 'Food steal per damage', min: 0, max: 5, step: 0.1, format: v => v.toFixed(1), automation: { samplingExponent: 1.5 } },
  { key: 'aggressionHeatStrength', label: 'Aggression tax strength', min: 0, max: 2, step: 0.05, format: v => v.toFixed(2) },
  { key: 'aggressionHeatRecoverySec', label: 'Aggression recovery (s)', min: 1, max: 60, step: 1, format: v => v.toFixed(0), automation: { round: true } },
  {
    key: 'metabolismPerSegment',
    label: 'Metabolic cost per segment',
    min: 0,
    max: 0.2,
    step: 0.005,
    format: v => v.toFixed(3),
  },
  {
    key: 'metabolismPerLength',
    label: 'Metabolic cost per length',
    min: 0,
    max: 0.3,
    step: 0.005,
    format: v => v.toFixed(3),
  },
  { key: 'reproductiveThreshold', label: 'Reproduction threshold', min: 10, max: 500, step: 10, automation: { round: true } },
  { key: 'locomotorImpulsePerLength', label: 'Locomotor pulse strength', min: 0, max: 280, step: 2, automation: { samplingExponent: 2 } },
  {
    key: 'locomotorFoodCost',
    label: 'Locomotor pulse food cost',
    min: 0,
    max: 0.01,
    step: 0.0001,
    format: v => v.toFixed(4),
    automation: { samplingExponent: 1.5 },
  },
  {
    key: 'impulseNutrientDemandRate',
    label: 'Impulse nutrient demand',
    min: 0,
    max: 0.01,
    step: 0.0002,
    format: v => v.toFixed(4),
    automation: { samplingExponent: 2 },
  },
  {
    key: 'environmentLocomotorNutrientToFoodScale',
    label: 'Loc nutrient->food scale',
    min: 0,
    max: 30,
    step: 0.25,
    format: v => v.toFixed(2),
  },
  {
    key: 'motionDamping',
    label: 'Motion damping',
    min: 0,
    max: 0.2,
    step: 0.0015,
    format: v => v.toFixed(3),
    automation: { samplingExponent: 2.5 },
  },
  { key: 'collisionFriction', label: 'Collision friction', min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
  { key: 'collisionRestitution', label: 'Collision bounce', min: 0, max: 3, step: 0.05, format: v => v.toFixed(2) },
  { key: 'killFoodTransferFraction', label: 'Kill food transfer fraction', min: 0, max: 1, step: 0.05, format: v => v.toFixed(2) },
  { key: 'foodDrivenHpRate', label: 'Food-driven HP rate', min: 0, max: 10, step: 0.5, format: v => v.toFixed(1) },
  {
    key: 'environmentNutrientPhotosynthMinMultiplier',
    label: 'Env photosynth floor',
    min: 0,
    max: 1,
    step: 0.01,
    format: v => v.toFixed(2),
  },
  {
    key: 'environmentNutrientConsumptionRate',
    label: 'Env nutrient consumption',
    min: 0,
    max: 3,
    step: 0.025,
    format: v => v.toFixed(2),
    automation: { samplingExponent: 1.5 },
  },
  {
    key: 'environmentNutrientRegenRate',
    label: 'Env nutrient regen',
    min: 0,
    max: 1,
    step: 0.01,
    format: v => v.toFixed(2),
    automation: { samplingExponent: 2.5 },
  },
  {
    key: 'environmentFootprintScale',
    label: 'Env footprint scale',
    min: 0.1,
    max: 2.5,
    step: 0.05,
    format: v => v.toFixed(2),
  },
  {
    key: 'environmentFootprintFalloffPower',
    label: 'Env footprint falloff power',
    min: 0.25,
    max: 6,
    step: 0.25,
    format: v => v.toFixed(2),
  },
  { key: 'genomeBaseSegmentBudget', label: 'Genome base segment budget', min: 4, max: 64, step: 2, automation: { round: true } },
  { key: 'genomeSymmetrySegmentBonus', label: 'Genome symmetry bonus', min: 0, max: 16, step: 1, automation: { round: true } },
  { key: 'genomeMinSegmentsPerGroup', label: 'Min segments per group', min: 1, max: 10, step: 1, automation: { round: true } },
];

const CONFIG_SLIDER_CATEGORIES: ConfigSliderCategory[] = [
  {
    label: 'Core Dynamics',
    keys: ['maxPopulation', 'mutationRate', 'reproductiveThreshold'],
  },
  {
    label: 'Survival Buffers',
    keys: ['baseMaxHp', 'hpPerWeightedLength', 'baseMaxFoodBuffer', 'foodBufferPerWeightedLength', 'foodDrivenHpRate', 'maxAgeMs'],
  },
  {
    label: 'Metabolism',
    keys: ['metabolismPerSegment', 'metabolismPerLength'],
  },
  {
    label: 'Photosynth Economy',
    keys: [
      'photosynthesisRate',
      'environmentNutrientPhotosynthMinMultiplier',
      'environmentNutrientConsumptionRate',
    ],
  },
  {
    label: 'Locomotor Economy',
    keys: [
      'locomotorFoodCost',
      'impulseNutrientDemandRate',
      'environmentLocomotorNutrientToFoodScale',
    ],
  },
  {
    label: 'Combat Pressure',
    keys: ['attackDamagePerLength', 'foodStealPerDamage', 'killFoodTransferFraction', 'aggressionHeatStrength', 'aggressionHeatRecoverySec'],
  },
  {
    label: 'Movement & Physics',
    keys: ['locomotorImpulsePerLength', 'motionDamping', 'collisionFriction', 'collisionRestitution'],
  },
  {
    label: 'Environment Field',
    keys: [
      'environmentNutrientRegenRate',
      'environmentFootprintScale',
      'environmentFootprintFalloffPower',
    ],
  },
  {
    label: 'Genome Segment Budget',
    keys: ['genomeBaseSegmentBudget', 'genomeSymmetrySegmentBonus', 'genomeMinSegmentsPerGroup'],
  },
];

export function getSliderInputId(key: NumericConfigKey): string {
  return String(key);
}

export function getSliderValueId(key: NumericConfigKey): string {
  return `${String(key)}Value`;
}

export function readSliderValue(definition: ConfigSliderDefinition, config: Config): number {
  if (definition.readValue) return definition.readValue(config);
  const value = config[definition.key];
  return typeof value === 'number' ? value : 0;
}

export function applySliderValue(definition: ConfigSliderDefinition, config: Config, value: number): void {
  if (definition.applyValue) {
    definition.applyValue(config, value);
    return;
  }
  config[definition.key] = value;
}

export function formatSliderValue(definition: ConfigSliderDefinition, value: number): string {
  return definition.format ? definition.format(value) : String(value);
}

function buildSliderGroup(definition: ConfigSliderDefinition, config: Config): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'slider-group';

  const label = document.createElement('label');
  label.appendChild(document.createTextNode(`${definition.label} `));

  const valueEl = document.createElement('span');
  valueEl.className = 'slider-value';
  valueEl.id = getSliderValueId(definition.key);

  const initialValue = readSliderValue(definition, config);
  valueEl.textContent = formatSliderValue(definition, initialValue);
  label.appendChild(valueEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.id = getSliderInputId(definition.key);
  input.min = definition.min.toString();
  input.max = definition.max.toString();
  input.step = definition.step.toString();
  input.value = initialValue.toString();

  group.appendChild(label);
  group.appendChild(input);
  return group;
}

function resetSliderToDefault(definition: ConfigSliderDefinition, config: Config, resetConfig: Config): void {
  const defaultValue = readSliderValue(definition, resetConfig);
  const input = document.getElementById(getSliderInputId(definition.key));

  if (input instanceof HTMLInputElement) {
    input.value = defaultValue.toString();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  applySliderValue(definition, config, defaultValue);
  const valueEl = document.getElementById(getSliderValueId(definition.key));
  if (valueEl) {
    valueEl.textContent = formatSliderValue(definition, defaultValue);
  }
}

function buildSliderCategoryHeader(
  label: string,
  description: string | undefined,
  onReset: () => void
): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'slider-category-header';

  const content = document.createElement('div');
  content.className = 'slider-category-header-content';

  const title = document.createElement('div');
  title.className = 'slider-category-title';
  title.textContent = label;
  content.appendChild(title);

  if (description) {
    const descriptionEl = document.createElement('div');
    descriptionEl.className = 'slider-category-description';
    descriptionEl.textContent = description;
    content.appendChild(descriptionEl);
  }

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'slider-category-reset-btn';
  resetButton.innerHTML = resetIcon;
  resetButton.title = `Reset ${label} sliders to baseline`;
  resetButton.ariaLabel = `Reset ${label} sliders to baseline`;
  resetButton.addEventListener('click', onReset);

  header.appendChild(content);
  header.appendChild(resetButton);
  return header;
}

function resetSliderCategory(
  keys: NumericConfigKey[],
  definitionsByKey: Map<NumericConfigKey, ConfigSliderDefinition>,
  config: Config,
  resetConfig: Config
): void {
  for (const key of keys) {
    const definition = definitionsByKey.get(key);
    if (!definition) continue;
    resetSliderToDefault(definition, config, resetConfig);
  }
}

export function renderConfigSliders(container: HTMLElement, config: Config, options: RenderConfigSlidersOptions = {}): void {
  const fragment = document.createDocumentFragment();
  const definitionsByKey = new Map<NumericConfigKey, ConfigSliderDefinition>();
  const usedKeys = new Set<NumericConfigKey>();

  for (const definition of CONFIG_SLIDERS) {
    definitionsByKey.set(definition.key, definition);
  }

  for (const category of CONFIG_SLIDER_CATEGORIES) {
    const categoryElement = document.createElement('section');
    categoryElement.className = 'slider-category';

    const header = buildSliderCategoryHeader(
      category.label,
      category.description,
      () => resetSliderCategory(
        category.keys,
        definitionsByKey,
        config,
        options.getResetConfig ? options.getResetConfig() : DEFAULT_CONFIG
      )
    );

    const body = document.createElement('div');
    body.className = 'slider-category-body';

    for (const key of category.keys) {
      const definition = definitionsByKey.get(key);
      if (!definition) continue;
      usedKeys.add(key);
      body.appendChild(buildSliderGroup(definition, config));
    }

    if (body.childElementCount === 0) {
      continue;
    }

    categoryElement.appendChild(header);
    categoryElement.appendChild(body);
    fragment.appendChild(categoryElement);
  }

  const uncategorized = CONFIG_SLIDERS.filter(definition => !usedKeys.has(definition.key));
  if (uncategorized.length > 0) {
    const categoryElement = document.createElement('section');
    categoryElement.className = 'slider-category';

    const uncategorizedKeys = uncategorized.map(definition => definition.key);
    const header = buildSliderCategoryHeader(
      'Other Settings',
      undefined,
      () => resetSliderCategory(
        uncategorizedKeys,
        definitionsByKey,
        config,
        options.getResetConfig ? options.getResetConfig() : DEFAULT_CONFIG
      )
    );
    categoryElement.appendChild(header);

    const body = document.createElement('div');
    body.className = 'slider-category-body';
    for (const definition of uncategorized) {
      body.appendChild(buildSliderGroup(definition, config));
    }

    categoryElement.appendChild(body);
    fragment.appendChild(categoryElement);
  }

  container.replaceChildren(fragment);
}

export function getAutomationDefaultRanges(): Record<string, SliderAutomationRange> {
  const ranges: Record<string, SliderAutomationRange> = {};

  for (const definition of CONFIG_SLIDERS) {
    if (definition.automation?.enabled === false) continue;

    const min = definition.automation?.min ?? definition.min;
    const max = definition.automation?.max ?? definition.max;
    const round = definition.automation?.round;
    const samplingExponent = definition.automation?.samplingExponent;

    const range: SliderAutomationRange = round
      ? { min, max, round: true }
      : { min, max };

    if (
      typeof samplingExponent === 'number' &&
      Number.isFinite(samplingExponent) &&
      samplingExponent > 0 &&
      samplingExponent !== 1
    ) {
      range.samplingExponent = samplingExponent;
    }

    ranges[String(definition.key)] = range;
  }

  return ranges;
}
