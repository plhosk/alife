import * as lobos from 'lobos';

export interface ParameterRange {
  name: string;
  min: number;
  max: number;
  transform?: 'linear' | 'log';
  quantize?: { step: number; min: number; max: number };
  round?: boolean;
}

export interface SobolMatrices {
  X: Record<string, number>[];
  B: Record<string, number>[];
  A: Record<string, Record<string, number>[]>;
  metadata: {
    sampleSize: number;
    parameterCount: number;
    totalRuns: number;
    parameterRanges: ParameterRange[];
  };
}

export interface SaltelliExperimentManifest {
  method: 'sobol-saltelli';
  preset: string;
  sampleSize: number;
  parameterCount: number;
  totalRuns: number;
  parameterRanges: ParameterRange[];
  runs: SaltelliExperimentRun[];
}

export interface SaltelliExperimentRun {
  id: string;
  settings: Record<string, unknown>;
  matrix: string;
  matrixIndex: number;
  variedParameter?: string;
}

function applyTransform(value: number, range: ParameterRange): number {
  let result = range.min + value * (range.max - range.min);

  if (range.transform === 'log') {
    result = Math.exp(result);
  }

  if (range.quantize) {
    result = Math.round(result / range.quantize.step) * range.quantize.step;
    result = Math.max(range.quantize.min, Math.min(range.quantize.max, result));
  }

  if (range.round) {
    result = Math.round(result);
  }

  return result;
}

function scaleRow(unitRow: number[], ranges: ParameterRange[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    result[r.name] = applyTransform(unitRow[i], r);
  }
  return result;
}

export function generateSobolSequence(N: number, dimensions: number, seed: number = 1): number[][] {
  const sequence = new lobos.Sobol(dimensions, { params: 'new-joe-kuo-6.1000', resolution: 32 });

  for (let i = 0; i < seed; i++) {
    sequence.take(1);
  }

  return sequence.take(N);
}

export function generateSobolMatrices(
  N: number,
  ranges: ParameterRange[],
  seed: number = 1
): SobolMatrices {
  const k = ranges.length;

  const X_unit = generateSobolSequence(N, k, seed);
  const B_unit = generateSobolSequence(N, k, seed + 1000);

  const X = X_unit.map(row => scaleRow(row, ranges));
  const B = B_unit.map(row => scaleRow(row, ranges));

  const A: Record<string, Record<string, number>[]> = {};
  for (let i = 0; i < k; i++) {
    const paramName = ranges[i].name;
    A[paramName] = X.map((xRow, n) => ({
      ...xRow,
      [paramName]: B[n][paramName],
    }));
  }

  return {
    X,
    B,
    A,
    metadata: {
      sampleSize: N,
      parameterCount: k,
      totalRuns: N * (k + 2),
      parameterRanges: ranges,
    },
  };
}

export function generateSaltelliManifest(
  N: number,
  ranges: ParameterRange[],
  preset: string = 'default',
  seed: number = 1
): SaltelliExperimentManifest {
  const matrices = generateSobolMatrices(N, ranges, seed);
  const runs: SaltelliExperimentRun[] = [];

  for (let i = 0; i < matrices.X.length; i++) {
    runs.push({
      id: `X_${i}`,
      settings: matrices.X[i],
      matrix: 'X',
      matrixIndex: i,
    });
  }

  for (let i = 0; i < matrices.B.length; i++) {
    runs.push({
      id: `B_${i}`,
      settings: matrices.B[i],
      matrix: 'B',
      matrixIndex: i,
    });
  }

  for (const [paramName, aRows] of Object.entries(matrices.A)) {
    for (let i = 0; i < aRows.length; i++) {
      runs.push({
        id: `A_${paramName}_${i}`,
        settings: aRows[i],
        matrix: `A_${paramName}`,
        variedParameter: paramName,
        matrixIndex: i,
      });
    }
  }

  return {
    method: 'sobol-saltelli',
    preset,
    sampleSize: N,
    parameterCount: ranges.length,
    totalRuns: runs.length,
    parameterRanges: ranges,
    runs,
  };
}
