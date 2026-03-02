import { Config, ENTITY_RESOURCE_CONSTANTS, Entity, LimbGroupDef, LINEAGE_CONSTANTS, SegmentDef, Vec2 } from '../types';
import { Genome } from '../genome';

let nextId = 1;
type RandomFn = () => number;

function degToRad(deg: number): number {
  return deg * Math.PI / 180;
}

function computeLocalGeometry(groups: LimbGroupDef[]): {
  mass: number;
  localCom: Vec2;
  inertia: number;
  localPositions: Array<{ start: Vec2; end: Vec2 }>;
  boundingRadius: number;
} {
  const localPositions: Array<{ start: Vec2; end: Vec2 }> = [];

  for (const group of groups) {
    const defs = group.segments;
    const symCount = Math.max(1, group.angles.length);

    for (let sym = 0; sym < symCount; sym++) {
      const rotationOffset = degToRad(group.angles[sym]);
      const isMirror = group.mode === 'mirror' && sym % 2 === 1;

      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const angleMultiplier = isMirror ? -1 : 1;

        if (def.parentIndex === -1) {
          const start: Vec2 = { x: 0, y: 0 };
          const angle = rotationOffset + degToRad(def.angle) * angleMultiplier;
          const end: Vec2 = {
            x: Math.cos(angle) * def.length,
            y: Math.sin(angle) * def.length
          };
          localPositions.push({ start, end });
        } else {
          const parentIdx = sym * defs.length + def.parentIndex;
          const parent = localPositions[parentIdx];
          const start: Vec2 = { ...parent.end };
          const parentAngle = Math.atan2(
            parent.end.y - parent.start.y,
            parent.end.x - parent.start.x
          );
          const angle = parentAngle + degToRad(def.angle) * angleMultiplier;
          const end: Vec2 = {
            x: start.x + Math.cos(angle) * def.length,
            y: start.y + Math.sin(angle) * def.length
          };
          localPositions.push({ start, end });
        }
      }
    }
  }

  let totalMass = 0;
  let comX = 0;
  let comY = 0;
  let defIndex = 0;
  for (let i = 0; i < localPositions.length; i++) {
    const pos = localPositions[i];
    let defLen = 0;
    let idx = defIndex;
    for (const group of groups) {
      const segsInGroup = group.segments.length * group.angles.length;
      if (idx < segsInGroup) {
        defLen = group.segments[idx % group.segments.length].length;
        break;
      }
      idx -= segsInGroup;
    }
    const midX = (pos.start.x + pos.end.x) / 2;
    const midY = (pos.start.y + pos.end.y) / 2;
    comX += midX * defLen;
    comY += midY * defLen;
    totalMass += defLen;
    defIndex++;
  }

  const localCom: Vec2 = totalMass > 0
    ? { x: comX / totalMass, y: comY / totalMass }
    : { x: 0, y: 0 };

  let inertia = 0;
  defIndex = 0;
  for (let i = 0; i < localPositions.length; i++) {
    const pos = localPositions[i];
    let defLen = 0;
    let idx = defIndex;
    for (const group of groups) {
      const segsInGroup = group.segments.length * group.angles.length;
      if (idx < segsInGroup) {
        defLen = group.segments[idx % group.segments.length].length;
        break;
      }
      idx -= segsInGroup;
    }
    const midX = (pos.start.x + pos.end.x) / 2;
    const midY = (pos.start.y + pos.end.y) / 2;
    const dx = midX - localCom.x;
    const dy = midY - localCom.y;
    const distSq = dx * dx + dy * dy;
    inertia += defLen * distSq;
    const segLen = Math.sqrt(
      (pos.end.x - pos.start.x) ** 2 +
      (pos.end.y - pos.start.y) ** 2
    );
    inertia += defLen * segLen * segLen / 12;
    defIndex++;
  }

  let boundingRadius = 0;
  for (const pos of localPositions) {
    const distStart = Math.sqrt(pos.start.x ** 2 + pos.start.y ** 2);
    const distEnd = Math.sqrt(pos.end.x ** 2 + pos.end.y ** 2);
    boundingRadius = Math.max(boundingRadius, distStart, distEnd);
  }

  return {
    mass: Math.max(1, totalMass),
    localCom,
    inertia: Math.max(1, inertia),
    localPositions,
    boundingRadius
  };
}

export function createEntity(
  genome: string,
  position: Vec2,
  config: Config,
  parentAncestors: number[] = [],
  parentId: number | null = null,
  randomFn: RandomFn = Math.random
): Entity | null {
  const groups = Genome.parseGroups(genome);
  if (groups.length === 0) return null;

  let totalLength = 0;
  let hpLength = 0;
  let foodBufferLength = 0;

  for (const group of groups) {
    const symCount = Math.max(1, group.angles.length);
    for (const seg of group.segments) {
      totalLength += seg.length * symCount;
      hpLength += seg.length * ENTITY_RESOURCE_CONSTANTS.hpWeight[seg.type] * symCount;
      foodBufferLength += seg.length * ENTITY_RESOURCE_CONSTANTS.foodBufferWeight[seg.type] * symCount;
    }
  }

  const baseMaxHp = config.baseMaxHp + hpLength * config.hpPerWeightedLength;
  const maxFoodBuffer = config.baseMaxFoodBuffer + foodBufferLength * config.foodBufferPerWeightedLength;
  const lengthMultiplier = totalLength / ENTITY_RESOURCE_CONSTANTS.reproLengthScale;
  const varianceMultiplier = ENTITY_RESOURCE_CONSTANTS.reproVarianceMin + randomFn() * ENTITY_RESOURCE_CONSTANTS.reproVarianceRange;
  const reproductiveThreshold = config.reproductiveThreshold * lengthMultiplier * varianceMultiplier;

  const ancestorIds = parentId !== null
    ? [...parentAncestors.slice(-(LINEAGE_CONSTANTS.maxLineageDepth - 1)), parentId]
    : [];

  const geometry = computeLocalGeometry(groups);

  const firstGroup = groups[0];
  const allSegmentDefs: SegmentDef[] = [];
  for (const group of groups) {
    allSegmentDefs.push(...group.segments);
  }

  return {
    id: nextId++,
    name: null,
    genome,
    limbGroups: groups,
    segmentDefs: allSegmentDefs,
    symmetry: groups.reduce((sum, g) => sum + g.symmetry, 0),
    symmetryMode: firstGroup.mode,
    symmetryAngles: firstGroup.angles,
    phaseMode: firstGroup.phaseMode,
    phaseSpread: firstGroup.phaseSpread,
    neuralPulseIntervalMs: firstGroup.neuralPulseIntervalMs,
    nextNeuralPulseTimeMs: randomFn() * firstGroup.neuralPulseIntervalMs,
    totalLength,
    segments: [],
    localPositions: geometry.localPositions,
    position: { ...position },
    com: { ...position },
    localCom: geometry.localCom,
    rotation: randomFn() * Math.PI * 2,
    velocity: { x: 0, y: 0 },
    angularVelocity: 0,
    hp: baseMaxHp,
    maxHp: baseMaxHp,
    foodBuffer: maxFoodBuffer * (ENTITY_RESOURCE_CONSTANTS.initialFoodRatioMin + randomFn() * ENTITY_RESOURCE_CONSTANTS.initialFoodRatioRange),
    maxFoodBuffer,
    reproductiveBuffer: 0,
    reproductiveThreshold,
    ageMs: 0,
    dead: false,
    deathTimeMs: 0,
    mass: geometry.mass,
    inertia: geometry.inertia,
    aabbMin: { ...position },
    aabbMax: { ...position },
    boundingRadius: geometry.boundingRadius,
    generation: 1,
    ancestorIds,
    aggressionHeat: 0,
    lastNeuralTargetId: null,
    lastNeuralTargetTimeMs: 0,
    lastNeuralBehavior: null,
    lastNeuralDirection: { x: 0, y: 0 },
  };
}
