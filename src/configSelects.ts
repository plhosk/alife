import { Config, CullingStrategy, NutrientFieldType } from './types';

type SelectControlId = 'simulationTimeScale' | 'worldSize' | 'cullingStrategy' | 'environmentCellSize' | 'nutrientFieldType';

interface SelectControlOption {
  value: string;
  label: string;
}

export interface SelectControlContext {
  config: Config;
  resizeWorld: (newSize: number) => void;
  setEnvironmentCellSize: (newCellSize: number) => void;
  setNutrientFieldType: (type: NutrientFieldType) => void;
  centerCamera: () => void;
  previousValue?: string;
}

export interface SelectControlDefinition {
  id: SelectControlId;
  options: SelectControlOption[];
  readValue: (config: Config) => string;
  applyValue: (value: string, context: SelectControlContext) => void;
}

export const CONFIG_SELECT_CONTROLS: SelectControlDefinition[] = [
  {
    id: 'simulationTimeScale',
    options: [
      { value: '0.25', label: '4.2 ms' },
      { value: '0.5', label: '8.3 ms' },
      { value: '1', label: '16.7 ms (default)' },
      { value: '1.5', label: '25.0 ms' },
      { value: '2', label: '33.3 ms' },
      { value: '4', label: '66.7 ms' },
      { value: '8', label: '133.3 ms' },
      { value: '16', label: '266.7 ms' },
      { value: '32', label: '533.3 ms' },
    ],
    readValue: config => config.simulationTimeScale.toString(),
    applyValue: (value, context) => {
      context.config.simulationTimeScale = parseFloat(value);
    }
  },
  {
    id: 'worldSize',
    options: [
      { value: '200', label: '200 × 200' },
      { value: '400', label: '400 × 400' },
      { value: '600', label: '600 × 600' },
      { value: '800', label: '800 × 800' },
      { value: '1200', label: '1200 × 1200' },
      { value: '1600', label: '1600 × 1600' },
      { value: '2400', label: '2400 × 2400' },
      { value: '3200', label: '3200 × 3200' },
      { value: '4800', label: '4800 × 4800' },
      { value: '6400', label: '6400 × 6400' },
    ],
    readValue: config => config.worldWidth.toString(),
    applyValue: (value, context) => {
      if (context.previousValue === value) {
        return;
      }
      context.previousValue = value;
      const newSize = parseInt(value, 10);
      context.resizeWorld(newSize);
      context.centerCamera();
    }
  },
  {
    id: 'nutrientFieldType',
    options: [
      { value: 'uniform', label: 'Uniform' },
      { value: 'center', label: 'Center' },
      { value: 'edges', label: 'Edges' },
      { value: 'ring', label: 'Ring' },
    ],
    readValue: config => config.nutrientFieldType,
    applyValue: (value, context) => {
      context.setNutrientFieldType(value as NutrientFieldType);
    }
  },
  {
    id: 'cullingStrategy',
    options: [
      { value: 'none', label: 'None' },
      { value: 'random', label: 'Random' },
      { value: 'oldest', label: 'Oldest' },
      { value: 'youngest', label: 'Youngest' },
      { value: 'lowest-hp', label: 'Lowest HP' },
      { value: 'lowest-food', label: 'Lowest food' },
      { value: 'most-common', label: 'Most common type' },
    ],
    readValue: config => config.cullingStrategy,
    applyValue: (value, context) => {
      context.config.cullingStrategy = value as CullingStrategy;
    }
  },
  {
    id: 'environmentCellSize',
    options: [
      { value: '1', label: '1 px' },
      { value: '2', label: '2 px' },
      { value: '4', label: '4 px' },
      { value: '8', label: '8 px' },
      { value: '16', label: '16 px' },
      { value: '32', label: '32 px' },
      { value: '64', label: '64 px' },
      { value: '128', label: '128 px' },
      { value: '256', label: '256 px' },
    ],
    readValue: config => config.environmentCellSize.toString(),
    applyValue: (value, context) => {
      const nextCellSize = parseInt(value, 10);
      if (!Number.isFinite(nextCellSize) || nextCellSize <= 0) return;
      context.setEnvironmentCellSize(nextCellSize);
    }
  }
];

export function bindSelectControl(definition: SelectControlDefinition, context: SelectControlContext): void {
  const select = document.getElementById(definition.id);
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select control: ${definition.id}`);
  }
  const fragment = document.createDocumentFragment();

  for (const optionDef of definition.options) {
    const option = document.createElement('option');
    option.value = optionDef.value;
    option.textContent = optionDef.label;
    fragment.appendChild(option);
  }

  select.replaceChildren(fragment);
  const currentValue = definition.readValue(context.config);
  select.value = currentValue;
  context.previousValue = currentValue;

  select.addEventListener('change', () => {
    definition.applyValue(select.value, context);
  });
}
