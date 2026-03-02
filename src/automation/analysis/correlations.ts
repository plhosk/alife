import { CorrelationAnalysis, RunAnalysis } from './types';
import { getMetricValue, interpretCorrelation, pearsonCorrelation, trunc } from './utils';

export function analyzeCorrelations(runs: RunAnalysis[]): CorrelationAnalysis[] {
  const surviving = runs.filter(r => !r.summary.collapseEvent && r.finalCensus);
  if (surviving.length < 3) return [];

  const correlations: CorrelationAnalysis[] = [];

  const pairs: Array<[string, string, string]> = [
    ['genomeEntropy', 'uniqueGenomes', 'Genome entropy vs unique genomes'],
    ['densityVariance', 'coverageRatio', 'Density variance vs coverage'],
    ['meanHpPercent', 'meanFoodPercent', 'HP vs food percentage'],
    ['generationMax', 'genomeEntropy', 'Generation vs diversity'],
    ['mobileCount', 'population', 'Mobility vs population'],
    ['predatorCount', 'deathsByAttack', 'Predators vs attack deaths'],
    ['segmentDiversity', 'hybridCounts', 'Segment diversity vs hybrids'],
  ];

  for (const [m1, m2, label] of pairs) {
    const values = surviving.map(r => ({
      x: getMetricValue(r.finalCensus, m1),
      y: getMetricValue(r.finalCensus, m2),
    }));

    const correlation = pearsonCorrelation(values.map(v => v.x), values.map(v => v.y));

    if (!isNaN(correlation)) {
      correlations.push({
        metric1: m1,
        metric2: m2,
        coefficient: trunc(correlation),
        interpretation: interpretCorrelation(correlation, label),
      });
    }
  }

  return correlations;
}
