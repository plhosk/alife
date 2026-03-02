import { SegmentType, SpawnConfig } from './models';

export const SPAWN_CONFIGS: SpawnConfig[] = [
  { name: 'Random', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]) },
  { name: '100% Armor', weights: new Map([[SegmentType.Armor, 1]]) },
  { name: '100% Attack', weights: new Map([[SegmentType.Attack, 1]]) },
  { name: '100% Locomotor', weights: new Map([[SegmentType.Locomotor, 1]]) },
  { name: '100% Photosynth', weights: new Map([[SegmentType.Photosynth, 1]]) },
  { name: '100% Neural', weights: new Map([[SegmentType.Neural, 1]]) },
  { name: '50% Armor', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]), guaranteedType: SegmentType.Armor, guaranteedRatio: 0.5 },
  { name: '50% Attack', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]), guaranteedType: SegmentType.Attack, guaranteedRatio: 0.5 },
  { name: '50% Locomotor', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]), guaranteedType: SegmentType.Locomotor, guaranteedRatio: 0.5 },
  { name: '50% Photosynth', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]), guaranteedType: SegmentType.Photosynth, guaranteedRatio: 0.5 },
  { name: '50% Neural', weights: new Map([
    [SegmentType.Armor, 1],
    [SegmentType.Photosynth, 1],
    [SegmentType.Locomotor, 1],
    [SegmentType.Attack, 1],
    [SegmentType.Neural, 1],
  ]), guaranteedType: SegmentType.Neural, guaranteedRatio: 0.5 },
];
