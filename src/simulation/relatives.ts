import { Entity, PANEL_CONSTANTS } from '../types';

export function getLivingRelatives(
  entities: Entity[],
  entityId: number
): Array<{ entity: Entity; relationship: string }> {
  const entity = entities.find(e => e.id === entityId && !e.dead);
  if (!entity) return [];

  const relatives: Map<number, { entity: Entity; closeness: number; relationship: string }> = new Map();

  for (const candidate of entities) {
    if (candidate.dead || candidate.id === entityId) continue;

    if (candidate.ancestorIds.includes(entityId)) {
      const idx = candidate.ancestorIds.indexOf(entityId);
      const lastIdx = candidate.ancestorIds.length - 1;
      const relationship = idx === lastIdx ? 'child' : 'grandchild';
      relatives.set(candidate.id, { entity: candidate, closeness: idx === lastIdx ? 1 : 2, relationship });
      continue;
    }

    for (const ancestorId of entity.ancestorIds) {
      if (candidate.id === ancestorId) {
        const ancestorIdx = entity.ancestorIds.indexOf(ancestorId);
        const lastIdx = entity.ancestorIds.length - 1;
        const relationship = ancestorIdx === lastIdx ? 'parent' : 'grandparent';
        const existing = relatives.get(candidate.id);
        const closeness = lastIdx - ancestorIdx + 3;
        if (!existing || closeness < existing.closeness) {
          relatives.set(candidate.id, { entity: candidate, closeness, relationship });
        }
        break;
      }
    }

    if (relatives.has(candidate.id)) continue;

    const entityParentId = entity.ancestorIds.length > 0 ? entity.ancestorIds[entity.ancestorIds.length - 1] : null;
    const candidateParentId = candidate.ancestorIds.length > 0 ? candidate.ancestorIds[candidate.ancestorIds.length - 1] : null;

    if (entityParentId !== null && entityParentId === candidateParentId) {
      relatives.set(candidate.id, { entity: candidate, closeness: 4, relationship: 'sibling' });
      continue;
    }

    for (const ancestorId of candidate.ancestorIds) {
      if (entity.ancestorIds.includes(ancestorId)) {
        relatives.set(candidate.id, { entity: candidate, closeness: 5, relationship: 'cousin' });
        break;
      }
    }
  }

  const sorted = Array.from(relatives.values())
    .sort((a, b) => a.closeness - b.closeness)
    .slice(0, PANEL_CONSTANTS.maxRelativesShown);

  return sorted;
}
