export function getMaxSegmentsForGroup(
  groupSymmetry: number,
  totalLimbs: number,
  genomeBaseSegmentBudget: number,
  genomeSymmetrySegmentBonus: number
): number {
  const bonus = (groupSymmetry - 1) * genomeSymmetrySegmentBonus;
  const budget = genomeBaseSegmentBudget + bonus;
  return Math.max(1, Math.floor(budget / totalLimbs));
}

export function getTotalLimbs<T extends { symmetry: number }>(groups: T[]): number {
  return groups.reduce((sum, g) => sum + g.symmetry, 0);
}
