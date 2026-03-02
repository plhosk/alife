import { Config, Entity, SegmentType, VISUAL_EFFECTS_CONSTANTS } from './types';

type BodyPlanKey = string;
const LOWEST_HP_CULL_PROBABILITY = 0.75;

function bucketCount(count: number, maxSegments: number): string {
  if (count <= 0) return '0';
  const clampedMaxSegments = Math.max(1, maxSegments);
  const bucketSize = Math.max(1, Math.ceil(clampedMaxSegments / 4));
  const bucketIndex = Math.min(3, Math.floor((count - 1) / bucketSize));
  return String(bucketIndex + 1);
}

function bucketSymmetry(symmetry: number): string {
  if (symmetry <= 1) return 'solo';
  if (symmetry === 2) return 'pair';
  return 'multi';
}

function getBodyPlanKey(entity: Entity, config: Config): BodyPlanKey {
  const counts = { armor: 0, photosynth: 0, locomotor: 0, attack: 0, neural: 0 };
  for (const def of entity.segmentDefs) {
    if (def.type === SegmentType.Armor) counts.armor++;
    else if (def.type === SegmentType.Photosynth) counts.photosynth++;
    else if (def.type === SegmentType.Locomotor) counts.locomotor++;
    else if (def.type === SegmentType.Attack) counts.attack++;
    else if (def.type === SegmentType.Neural) counts.neural++;
  }
  const maxSegments = config.genomeBaseSegmentBudget + config.genomeSymmetrySegmentBonus;
  const limbGroupCount = Math.max(1, entity.limbGroups.length);
  const symmetryBucket = bucketSymmetry(entity.symmetry);

  return [
    bucketCount(counts.armor, maxSegments),
    bucketCount(counts.photosynth, maxSegments),
    bucketCount(counts.locomotor, maxSegments),
    bucketCount(counts.attack, maxSegments),
    bucketCount(counts.neural, maxSegments),
    `g${limbGroupCount}`,
    `s${symmetryBucket}`,
  ].join(',');
}

export function sortByAgeDesc(a: Entity, b: Entity): number {
  return b.ageMs - a.ageMs;
}

export function killRandom(entities: Entity[], randomFn: () => number = Math.random): number {
  const living = entities.filter(e => !e.dead);
  if (living.length === 0) return 0;
  const victim = living[Math.floor(randomFn() * living.length)];
  victim.dead = true;
  if (VISUAL_EFFECTS_CONSTANTS.showCullingDeathFlash) {
    victim.deathTimeMs = performance.now();
  }
  return 1;
}

export function killByMinMetric(entities: Entity[], metric: (e: Entity) => number): number {
  const living = entities.filter(e => !e.dead);
  if (living.length === 0) return 0;
  let victim = living[0];
  let minVal = metric(victim);
  for (let i = 1; i < living.length; i++) {
    const val = metric(living[i]);
    if (val < minVal) {
      minVal = val;
      victim = living[i];
    }
  }
  victim.dead = true;
  if (VISUAL_EFFECTS_CONSTANTS.showCullingDeathFlash) {
    victim.deathTimeMs = performance.now();
  }
  return 1;
}

export function killMostCommonType(entities: Entity[], config: Config, randomFn: () => number = Math.random): number {
  const living = entities.filter(e => !e.dead);
  if (living.length === 0) return 0;

  const groups = new Map<BodyPlanKey, Entity[]>();
  for (const entity of living) {
    const key = getBodyPlanKey(entity, config);
    const group = groups.get(key) || [];
    group.push(entity);
    groups.set(key, group);
  }

  let largestGroup: Entity[] = [];
  for (const group of groups.values()) {
    if (group.length > largestGroup.length) {
      largestGroup = group;
    }
  }

  if (largestGroup.length === 0) return 0;

  if (randomFn() > LOWEST_HP_CULL_PROBABILITY) {
    const victim = largestGroup[Math.floor(randomFn() * largestGroup.length)];
    victim.dead = true;
    if (VISUAL_EFFECTS_CONSTANTS.showCullingDeathFlash) {
      victim.deathTimeMs = performance.now();
    }
    return 1;
  }

  let victim = largestGroup[0];
  let minHp = victim.hp;
  for (let i = 1; i < largestGroup.length; i++) {
    if (largestGroup[i].hp < minHp) {
      minHp = largestGroup[i].hp;
      victim = largestGroup[i];
    }
  }
  victim.dead = true;
  if (VISUAL_EFFECTS_CONSTANTS.showCullingDeathFlash) {
    victim.deathTimeMs = performance.now();
  }
  return 1;
}
