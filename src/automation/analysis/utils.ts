import { CensusData } from './types';

export function getFinalCensus(censusData: CensusData[]): CensusData | null {
  if (censusData.length > 0) {
    return censusData[censusData.length - 1];
  }
  return null;
}

export function trunc(n: number): number {
  if (n === 0) return 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n);
  if (abs >= 100) return Math.round(n * 10) / 10;
  if (abs >= 10) return Math.round(n * 100) / 100;
  if (abs >= 1) return Math.round(n * 1000) / 1000;
  return Math.round(n * 10000) / 10000;
}

export function getMetricValue(census: CensusData | null, metric: string): number {
  if (!census) return 0;
  const data = census as unknown as Record<string, unknown>;
  const value = data[metric];
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null) {
    const nested = value as Record<string, unknown>;
    if ('Arm' in nested && typeof nested.Arm === 'number') return nested.Arm;
  }
  return 0;
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return NaN;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return NaN;
  return numerator / denominator;
}

export function interpretCorrelation(r: number, label: string): string {
  const absR = Math.abs(r);
  const strength = absR > 0.7 ? 'strong' : absR > 0.4 ? 'moderate' : absR > 0.2 ? 'weak' : 'negligible';
  const direction = r > 0 ? 'positive' : 'negative';
  return `${strength} ${direction} correlation in ${label}`;
}
