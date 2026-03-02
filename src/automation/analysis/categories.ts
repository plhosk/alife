import { CategoryResult, RunAnalysis } from './types';
import { getMetricValue, trunc } from './utils';

export function generateCategories(runs: RunAnalysis[]): CategoryResult[] {
  const categories: CategoryResult[] = [];

  const surviving = runs.filter(r => !r.summary.collapseEvent);
  const collapsed = runs.filter(r => r.summary.collapseEvent);

  categories.push({
    category: 'survivors',
    description: 'Runs where the population survived',
    fields: ['runId', 'score'],
    runs: surviving.map(r => [r.runId, r.summary.finalPopulation]),
  });

  categories.push({
    category: 'collapsed',
    description: 'Runs where the population went extinct',
    fields: ['runId', 'score'],
    runs: collapsed.map(r => [r.runId, r.summary.peakPopulation]),
  });

  const byDiversity = [...surviving]
    .map(r => [r.runId, trunc(r.summary.meanDiversity)] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_diverse',
    description: 'Highest genome diversity among surviving runs',
    fields: ['runId', 'score'],
    runs: byDiversity.slice(0, 5),
  });

  const byDensityVariance = [...surviving]
    .map(r => [r.runId, trunc(getMetricValue(r.finalCensus, 'densityVariance'))] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_interesting_distribution',
    description: 'Highest density variance - clustered, dynamic distributions',
    fields: ['runId', 'score'],
    runs: byDensityVariance.slice(0, 5),
  });

  const byBalance = [...surviving]
    .map(r => {
      const coverage = getMetricValue(r.finalCensus, 'coverageRatio');
      const neighbor = getMetricValue(r.finalCensus, 'meanNearestNeighbor');
      const coverageScore = 1 - Math.abs(coverage - 1);
      const neighborScore = neighbor > 0 ? Math.min(neighbor / 50, 1) : 0;
      return [r.runId, trunc((coverageScore + neighborScore) / 2)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'best_balanced',
    description: 'Most uniform spatial distribution (coverage ~1.0, even spread)',
    fields: ['runId', 'score'],
    runs: byBalance.slice(0, 5),
  });

  const byCombat = [...surviving]
    .map(r => {
      const attacks = getMetricValue(r.finalCensus, 'deathsByAttack');
      const armorPct = r.finalCensus?.segmentPercentages?.Arm ?? 0;
      const attackPct = r.finalCensus?.segmentPercentages?.Att ?? 0;
      return [r.runId, trunc(attacks + armorPct * 100 + attackPct * 100)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_combative',
    description: 'Runs with the most combat activity',
    fields: ['runId', 'score'],
    runs: byCombat.slice(0, 5),
  });

  const byComplexity = [...surviving]
    .map(r => {
      const segments = getMetricValue(r.finalCensus, 'meanSegmentsPerEntity');
      const length = getMetricValue(r.finalCensus, 'meanTotalLength');
      return [r.runId, trunc(segments * 10 + length / 100)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_complex',
    description: 'Entities with most segments and largest body size',
    fields: ['runId', 'score'],
    runs: byComplexity.slice(0, 5),
  });

  const byGenerations = [...surviving]
    .map(r => {
      const genMax = getMetricValue(r.finalCensus, 'generationMax');
      const genMean = getMetricValue(r.finalCensus, 'generationMean');
      return [r.runId, trunc(genMax + genMean)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_evolved',
    description: 'Highest generational depth reached',
    fields: ['runId', 'score'],
    runs: byGenerations.slice(0, 5),
  });

  const byHybrid = [...surviving]
    .map(r => {
      const hybrids = getMetricValue(r.finalCensus, 'hybridCounts');
      const pop = r.summary.finalPopulation;
      return [r.runId, trunc(pop > 0 ? hybrids / pop : 0)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'most_hybridized',
    description: 'Populations with most multi-type entities',
    fields: ['runId', 'score'],
    runs: byHybrid.slice(0, 5),
  });

  const byLongevity = [...surviving]
    .map(r => {
      const ageMaxMs = getMetricValue(r.finalCensus, 'ageMaxMs');
      return [r.runId, trunc(ageMaxMs / 1000)] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);

  categories.push({
    category: 'longest_lived',
    description: 'Entities with longest lifespans',
    fields: ['runId', 'score'],
    runs: byLongevity.slice(0, 5),
  });

  return categories;
}
