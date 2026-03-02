import type { SobolSensitivityIndices } from './types.js';

export interface SaltelliOutputs {
  fX: number[];
  fB: number[];
  fA: Record<string, number[]>;
}

export interface SaltelliConfidenceIntervals {
  firstOrder: Record<string, { lower: number; upper: number }>;
  totalOrder: Record<string, { lower: number; upper: number }>;
}

export interface SaltelliResult {
  indices: SobolSensitivityIndices;
  confidence?: SaltelliConfidenceIntervals;
  bootstrapSamples?: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function percentileInterval(values: number[], lowerP: number, upperP: number): { lower: number; upper: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    lower: percentile(sorted, lowerP),
    upper: percentile(sorted, upperP),
  };
}

export function computeSobolIndicesSaltelli(
  outputs: SaltelliOutputs,
  parameterKeys: string[]
): SobolSensitivityIndices {
  const { fX, fB, fA } = outputs;
  const N = fX.length;

  if (N === 0) {
    const result: SobolSensitivityIndices = { firstOrder: {}, totalOrder: {} };
    for (const key of parameterKeys) {
      result.firstOrder[key] = 0;
      result.totalOrder[key] = 0;
    }
    result.warning = 'No samples provided';
    return result;
  }

  const VY = variance(fX);

  if (VY === 0) {
    const result: SobolSensitivityIndices = { firstOrder: {}, totalOrder: {} };
    for (const key of parameterKeys) {
      result.firstOrder[key] = 0;
      result.totalOrder[key] = 0;
    }
    result.warning = 'Zero output variance';
    return result;
  }

  const denom = 2 * N - 1;

  const firstOrder: Record<string, number> = {};
  const totalOrder: Record<string, number> = {};

  for (const paramKey of parameterKeys) {
    const fAi = fA[paramKey];
    if (!fAi || fAi.length !== N) {
      firstOrder[paramKey] = 0;
      totalOrder[paramKey] = 0;
      continue;
    }

    let sumFB = 0;
    for (let n = 0; n < N; n++) {
      sumFB += (fB[n] - fAi[n]) ** 2;
    }

    let sumFX = 0;
    for (let n = 0; n < N; n++) {
      sumFX += (fX[n] - fAi[n]) ** 2;
    }

    const VCE = VY - sumFB / denom;
    const VCEcompl = sumFX / denom;
    firstOrder[paramKey] = VCE / VY;
    totalOrder[paramKey] = VCEcompl / VY;

    if (totalOrder[paramKey] < firstOrder[paramKey]) {
      totalOrder[paramKey] = firstOrder[paramKey];
    }
    if (firstOrder[paramKey] < 0) firstOrder[paramKey] = 0;
    if (firstOrder[paramKey] > 1) firstOrder[paramKey] = 1;
    if (totalOrder[paramKey] < 0) totalOrder[paramKey] = 0;
    if (totalOrder[paramKey] > 1) totalOrder[paramKey] = 1;
  }

  return { firstOrder, totalOrder };
}

export function bootstrapSobolIndices(
  outputs: SaltelliOutputs,
  parameterKeys: string[],
  bootstrapSamples: number = 1000
): SaltelliResult {
  const N = outputs.fX.length;

  if (N === 0) {
    return {
      indices: computeSobolIndicesSaltelli(outputs, parameterKeys),
      confidence: {
        firstOrder: Object.fromEntries(parameterKeys.map(k => [k, { lower: 0, upper: 0 }])),
        totalOrder: Object.fromEntries(parameterKeys.map(k => [k, { lower: 0, upper: 0 }])),
      },
      bootstrapSamples: 0,
    };
  }

  const firstOrderSamples: Record<string, number[]> = {};
  const totalOrderSamples: Record<string, number[]> = {};

  for (const key of parameterKeys) {
    firstOrderSamples[key] = [];
    totalOrderSamples[key] = [];
  }

  for (let b = 0; b < bootstrapSamples; b++) {
    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      indices.push(Math.floor(Math.random() * N));
    }

    const resampled: SaltelliOutputs = {
      fX: indices.map(i => outputs.fX[i]),
      fB: indices.map(i => outputs.fB[i]),
      fA: Object.fromEntries(
        Object.entries(outputs.fA).map(([k, v]) => [k, indices.map(i => v[i])])
      ),
    };

    const result = computeSobolIndicesSaltelli(resampled, parameterKeys);
    for (const key of parameterKeys) {
      firstOrderSamples[key].push(result.firstOrder[key] ?? 0);
      totalOrderSamples[key].push(result.totalOrder[key] ?? 0);
    }
  }

  const confidence: SaltelliConfidenceIntervals = {
    firstOrder: Object.fromEntries(
      parameterKeys.map(k => [k, percentileInterval(firstOrderSamples[k], 0.025, 0.975)])
    ),
    totalOrder: Object.fromEntries(
      parameterKeys.map(k => [k, percentileInterval(totalOrderSamples[k], 0.025, 0.975)])
    ),
  };

  return {
    indices: computeSobolIndicesSaltelli(outputs, parameterKeys),
    confidence,
    bootstrapSamples,
  };
}

export function ishigami(x: [number, number, number], a: number = 7, b: number = 0.1): number {
  return Math.sin(x[0]) + a * Math.sin(x[1]) ** 2 + b * x[2] ** 4 * Math.sin(x[0]);
}

export function sobolG(x: number[], a: number[] = [0, 1, 4.5, 9, 99, 99, 99, 99]): number {
  let result = 1;
  for (let i = 0; i < x.length; i++) {
    const ai = a[i] ?? 99;
    result *= (Math.abs(4 * x[i] - 2) + ai) / (1 + ai);
  }
  return result;
}

export const ISHIGAMI_ANALYTICAL = {
  firstOrder: [0.3139, 0.4424, 0],
  totalOrder: [0.5576, 0.4424, 0.2437],
};

export function validateWithIshigami(
  matrices: { X: Record<string, number>[]; B: Record<string, number>[]; A: Record<string, Record<string, number>[]> }
): {
  computed: SobolSensitivityIndices;
  analytical: typeof ISHIGAMI_ANALYTICAL;
  errors: { firstOrder: number[]; totalOrder: number[] };
} {
  const fX = matrices.X.map((row: Record<string, number>) => ishigami([row.x1, row.x2, row.x3]));
  const fB = matrices.B.map((row: Record<string, number>) => ishigami([row.x1, row.x2, row.x3]));
  const fA: Record<string, number[]> = {
    x1: matrices.A.x1.map((row: Record<string, number>) => ishigami([row.x1, row.x2, row.x3])),
    x2: matrices.A.x2.map((row: Record<string, number>) => ishigami([row.x1, row.x2, row.x3])),
    x3: matrices.A.x3.map((row: Record<string, number>) => ishigami([row.x1, row.x2, row.x3])),
  };

  const computed = computeSobolIndicesSaltelli({ fX, fB, fA }, ['x1', 'x2', 'x3']);

  const errors = {
    firstOrder: [
      Math.abs((computed.firstOrder.x1 ?? 0) - ISHIGAMI_ANALYTICAL.firstOrder[0]),
      Math.abs((computed.firstOrder.x2 ?? 0) - ISHIGAMI_ANALYTICAL.firstOrder[1]),
      Math.abs((computed.firstOrder.x3 ?? 0) - ISHIGAMI_ANALYTICAL.firstOrder[2]),
    ],
    totalOrder: [
      Math.abs((computed.totalOrder.x1 ?? 0) - ISHIGAMI_ANALYTICAL.totalOrder[0]),
      Math.abs((computed.totalOrder.x2 ?? 0) - ISHIGAMI_ANALYTICAL.totalOrder[1]),
      Math.abs((computed.totalOrder.x3 ?? 0) - ISHIGAMI_ANALYTICAL.totalOrder[2]),
    ],
  };

  return { computed, analytical: ISHIGAMI_ANALYTICAL, errors };
}
