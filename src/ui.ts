import { SEGMENT_COLORS, Entity, FoodIncomeBreakdown, SegmentType } from './types';
import { segmentTypeState } from './segmentTypeState';

export interface SliderBinding {
  input: HTMLInputElement;
  display: HTMLElement;
  format: (value: number) => string;
}

export function bindSlider(
  inputId: string,
  displayId: string,
  initialValue: number,
  onChange: (value: number) => void,
  format: (value: number) => string = String
): SliderBinding {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const display = document.getElementById(displayId)!;
  
  input.value = initialValue.toString();
  display.textContent = format(initialValue);
  
  input.addEventListener('input', () => {
    const value = parseFloat(input.value);
    display.textContent = format(value);
    onChange(value);
  });
  
  return { input, display, format };
}

export function buildEntityStats(
  entity: Entity,
  segCount: number,
  photosynthesisMultiplier: number,
  nutrientDensityAtCom: number,
  currentSpeed: number,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const aggressionHeatPct = Math.round(Math.min(1, Math.max(0, entity.aggressionHeat)) * 100);
  const photosynthEfficiencyPct = Math.round(Math.max(0, photosynthesisMultiplier) * 100);
  const nutrientDensity = Math.min(1, Math.max(0, nutrientDensityAtCom));
  const stats = [
    { label: 'Hp', value: `${Math.round(entity.hp)} / ${Math.round(entity.maxHp)}` },
    { label: 'Food', value: `${Math.round(entity.foodBuffer)} / ${Math.round(entity.maxFoodBuffer)}` },
    { label: 'Repro', value: `${Math.round(entity.reproductiveBuffer)} / ${Math.round(entity.reproductiveThreshold)}` },
    { label: 'Segments', value: segCount.toString() },
    { label: 'Generation', value: entity.generation.toString() },
    { label: 'Age', value: `${Math.round(entity.ageMs / 1000)}s` },
    { label: 'Speed', value: `${Math.round(currentSpeed)} u/s` },
    { label: 'Nutrient density', value: nutrientDensity.toFixed(3) },
    { label: 'Aggression heat', value: `${aggressionHeatPct}%` },
    { label: 'Photosynth efficiency', value: `${photosynthEfficiencyPct}%` },
  ];
  
  for (const stat of stats) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    const value = document.createElement('span');
    row.className = 'stat-row';
    label.className = 'stat-label';
    value.className = 'stat-value';
    label.textContent = stat.label;
    value.textContent = stat.value;
    row.appendChild(label);
    row.appendChild(value);
    fragment.appendChild(row);
  }
  
  return fragment;
}

export function buildIncomePanel(incomeStats: FoodIncomeBreakdown | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const toRate = (value: number): string => `${value.toFixed(2)}`;

  const buildTable = (
    title: string,
    unit: string,
    rows: Array<{ label: string; className?: string; value: number }>
  ): HTMLElement => {
    const table = document.createElement('div');
    table.className = 'income-table';

    const header = document.createElement('div');
    header.className = 'income-header-row';

    const headerTitle = document.createElement('span');
    headerTitle.className = 'income-header';
    headerTitle.textContent = title;

    const headerUnit = document.createElement('span');
    headerUnit.className = 'income-unit';
    headerUnit.textContent = unit;

    header.appendChild(headerTitle);
    header.appendChild(headerUnit);
    table.appendChild(header);

    for (const rowData of rows) {
      const row = document.createElement('div');
      row.className = 'income-row';

      const label = document.createElement('span');
      label.className = rowData.className ? `income-label ${rowData.className}` : 'income-label';
      label.textContent = rowData.label;

      const value = document.createElement('span');
      value.textContent = toRate(rowData.value);

      row.appendChild(label);
      row.appendChild(value);
      table.appendChild(row);
    }

    return table;
  };

  const incomeRows = [
    { label: 'Photosynth', className: 'photosynth', value: incomeStats?.photosynthesis ?? 0 },
    { label: 'Locomotion', className: 'locomotion', value: incomeStats?.locomotion ?? 0 },
    { label: 'Attack', className: 'attack', value: incomeStats?.attack ?? 0 },
  ];
  const totalIncome = incomeRows.reduce((sum, row) => sum + row.value, 0);
  const demandRows = [
    { label: 'Metabolism', value: incomeStats?.metabolismDemand ?? 0 },
    { label: 'Locomotion', value: incomeStats?.locomotionDemand ?? 0 },
  ];
  const totalDemand = demandRows.reduce((sum, row) => sum + row.value, 0);

  const nutrientRows = [
    { label: 'Photosynth', className: 'photosynth', value: incomeStats?.photosynthNutrientConsumed ?? 0 },
    { label: 'Locomotion', className: 'locomotion', value: incomeStats?.locomotionNutrientConsumed ?? 0 },
  ];
  const totalNutrient = nutrientRows.reduce((sum, row) => sum + row.value, 0);

  fragment.appendChild(buildTable('Food Income', 'food/sec', [...incomeRows, { label: 'Total', value: totalIncome }]));
  fragment.appendChild(buildTable('Food Demand', 'food/sec', [...demandRows, { label: 'Total', value: totalDemand }]));
  fragment.appendChild(buildTable('Nutrient Use', 'nutrient/sec', [...nutrientRows, { label: 'Total', value: totalNutrient }]));
  
  return fragment;
}

export interface RelativeInfo {
  entity: Entity;
  relationship: string;
}

export function buildFamilyMember(
  relative: RelativeInfo,
  onCanvasReady: (canvas: HTMLCanvasElement, entity: Entity) => void,
  onClick: (entity: Entity) => void
): HTMLElement {
  const memberDiv = document.createElement('div');
  memberDiv.className = 'family-member';
  memberDiv.dataset.entityId = relative.entity.id.toString();
  
  const nameSpan = document.createElement('span');
  nameSpan.className = 'family-member-name';
  nameSpan.textContent = relative.entity.name?.slice(0, 6) || '';
  nameSpan.title = relative.entity.name || '';
  
  const canvas = document.createElement('canvas');
  canvas.className = 'family-member-preview';
  canvas.width = 60;
  canvas.height = 60;
  
  const relationshipSpan = document.createElement('span');
  relationshipSpan.className = 'family-member-relationship';
  relationshipSpan.textContent = relative.relationship;
  
  memberDiv.appendChild(nameSpan);
  memberDiv.appendChild(canvas);
  memberDiv.appendChild(relationshipSpan);
  
  requestAnimationFrame(() => {
    onCanvasReady(canvas, relative.entity);
  });
  
  memberDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(relative.entity);
  });
  
  return memberDiv;
}

export function sortRelatives(relatives: RelativeInfo[]): void {
  const order: Record<string, number> = {
    'grandparent': 1,
    'parent': 2,
    'sibling': 3,
    'cousin': 4,
    'child': 5,
    'grandchild': 6
  };
  
  relatives.sort((a, b) => {
    const orderA = order[a.relationship] ?? 99;
    const orderB = order[b.relationship] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return b.entity.ageMs - a.entity.ageMs;
  });
}

export function renderSpawnGrid(container: HTMLElement, configs: Array<{ name: string }>): void {
  const fragment = document.createDocumentFragment();

  const segmentOrder: Record<string, number> = {
    'Armor': 0,
    'Attack': 1,
    'Locomotor': 2,
    'Neural': 3,
    'Photosynth': 4,
  };

  const createOption = (configName: string, index: number): HTMLElement => {
    const card = document.createElement('div');
    card.className = 'spawn-option';

    const label = document.createElement('div');
    label.className = 'spawn-option-label';
    const compactName = configName.replace(/^\d+%\s*/, '');
    const acronymByName: Record<string, string> = {
      'Armor': 'Arm',
      'Photosynth': 'Pho',
      'Locomotor': 'Loc',
      'Attack': 'Att',
      'Neural': 'Neu',
    };
    label.textContent = acronymByName[compactName] ?? compactName;

    const controls = document.createElement('div');
    controls.className = 'spawn-option-buttons';

    const plusOne = document.createElement('button');
    plusOne.type = 'button';
    plusOne.dataset.spawnCount = '1';
    plusOne.dataset.spawnConfigIndex = String(index);
    plusOne.textContent = '1';

    const plusTwenty = document.createElement('button');
    plusTwenty.type = 'button';
    plusTwenty.dataset.spawnCount = '20';
    plusTwenty.dataset.spawnConfigIndex = String(index);
    plusTwenty.textContent = '20';

    controls.appendChild(plusOne);
    controls.appendChild(plusTwenty);
    card.appendChild(label);
    card.appendChild(controls);

    card.dataset.segmentType = compactName;

    return card;
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'spawn-grid-wrapper';

  const leftColumn = document.createElement('div');
  leftColumn.className = 'spawn-column';

  const leftTitle = document.createElement('div');
  leftTitle.className = 'spawn-column-title';
  leftTitle.textContent = '100% segment';
  leftColumn.appendChild(leftTitle);

  const rightColumn = document.createElement('div');
  rightColumn.className = 'spawn-column';

  const rightTitle = document.createElement('div');
  rightTitle.className = 'spawn-column-title';
  rightTitle.textContent = '50% segment';
  rightColumn.appendChild(rightTitle);

  const filterAndSort = (prefix: string): Array<{ config: { name: string }; index: number }> =>
    configs
      .map((config, index) => ({ config, index }))
      .filter(({ config }) => config.name.startsWith(prefix))
      .sort((a, b) => {
        const aName = a.config.name.replace(/^\d+%\s*/, '');
        const bName = b.config.name.replace(/^\d+%\s*/, '');
        return (segmentOrder[aName] ?? 99) - (segmentOrder[bName] ?? 99);
      });

  const hundredPercent = filterAndSort('100%');
  const fiftyPercent = filterAndSort('50%');

  for (const entry of hundredPercent) {
    leftColumn.appendChild(createOption(entry.config.name, entry.index));
  }

  for (const entry of fiftyPercent) {
    rightColumn.appendChild(createOption(entry.config.name, entry.index));
  }

  wrapper.appendChild(leftColumn);
  wrapper.appendChild(rightColumn);
  fragment.appendChild(wrapper);

  container.replaceChildren(fragment);
}

export function updateSpawnGridDisabledState(): void {
  const segmentTypeMap: Record<string, SegmentType> = {
    'Armor': SegmentType.Armor,
    'Photosynth': SegmentType.Photosynth,
    'Locomotor': SegmentType.Locomotor,
    'Attack': SegmentType.Attack,
    'Neural': SegmentType.Neural,
  };

  document.querySelectorAll('.spawn-option[data-segment-type]').forEach((el) => {
    const typeName = el.getAttribute('data-segment-type');
    if (!typeName) return;
    const type = segmentTypeMap[typeName];
    if (!type) return;
    
    const isEnabled = segmentTypeState.isEnabled(type);
    el.classList.toggle('spawn-option-disabled', !isEnabled);
    el.querySelectorAll('button').forEach((btn) => {
      (btn as HTMLButtonElement).disabled = !isEnabled;
    });
  });
}

export function applyLegendColors(): void {
  document.querySelectorAll('[data-segment]').forEach((el) => {
    const type = el.getAttribute('data-segment') as SegmentType;
    if (SEGMENT_COLORS[type]) {
      (el as HTMLElement).style.background = SEGMENT_COLORS[type];
    }
  });
}
