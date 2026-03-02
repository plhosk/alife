import fs from 'node:fs';
import path from 'node:path';
import { computeSobolIndicesSaltelli, bootstrapSobolIndices, ishigami, ISHIGAMI_ANALYTICAL } from '../src/automation/analysis/sobol-saltelli.ts';

/* eslint-disable no-undef */

function parseResultsJson(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    return data.experiments || [];
  } catch {
    return [];
  }
}

function buildSaltelliOutputs(experiments, manifest) {
  const runMap = new Map();
  for (const exp of experiments) {
    runMap.set(exp.id, exp);
  }

  const fX = [];
  const fB = [];
  const fA = {};

  const parameterKeys = manifest.parameterRanges.map(r => r.name);
  for (const key of parameterKeys) {
    fA[key] = [];
  }

  for (const run of manifest.runs) {
    const exp = runMap.get(run.id);
    const output = exp?.summary?.finalPopulation ?? 0;

    if (run.matrix === 'X') {
      fX[run.matrixIndex] = output;
    } else if (run.matrix === 'B') {
      fB[run.matrixIndex] = output;
    } else if (run.matrix.startsWith('A_')) {
      const paramName = run.variedParameter;
      if (paramName && fA[paramName]) {
        fA[paramName][run.matrixIndex] = output;
      }
    }
  }

  const N = manifest.sampleSize;
  const validateArray = (arr, name) => {
    if (arr.length !== N) {
      console.warn(`Warning: ${name} has ${arr.length} samples, expected ${N}`);
      while (arr.length < N) arr.push(0);
    }
  };

  validateArray(fX, 'fX');
  validateArray(fB, 'fB');
  for (const key of parameterKeys) {
    validateArray(fA[key], `fA[${key}]`);
  }

  return { fX, fB, fA, parameterKeys };
}

function formatParameterName(key) {
  const nameMap = {
    photosynthesisRate: 'photosynthesis rate',
    environmentNutrientPhotosynthMinMultiplier: 'nutrient→photosynth multiplier',
    environmentNutrientConsumptionRate: 'nutrient consumption rate',
    locomotorFoodCost: 'locomotor food cost',
    impulseNutrientDemandRate: 'impulse nutrient demand',
    environmentLocomotorNutrientToFoodScale: 'locomotor nutrient→food scale',
    attackDamagePerLength: 'attack damage per length',
    foodStealPerDamage: 'food steal per damage',
    locomotorImpulsePerLength: 'locomotor impulse per length',
    environmentNutrientRegenRate: 'nutrient regen rate',
    environmentFootprintScale: 'environment footprint scale',
    maxPopulation: 'max population',
  };
  return nameMap[key] || key;
}

function interpretInfluence(value) {
  if (value > 0.5) return 'Very strong';
  if (value > 0.2) return 'Strong';
  if (value > 0.1) return 'Moderate';
  if (value > 0.05) return 'Weak';
  return 'Minimal';
}

function generateReportText(result, manifest, metric) {
  const lines = [];

  lines.push('='.repeat(80));
  lines.push('SALTELLI SOBOL SENSITIVITY ANALYSIS REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push('Method: sobol-saltelli');
  lines.push(`Preset: ${manifest.preset}`);
  lines.push(`Sample size (N): ${manifest.sampleSize}`);
  lines.push(`Parameters (k): ${manifest.parameterCount}`);
  lines.push(`Total runs: ${manifest.totalRuns}`);
  lines.push(`Output metric: ${metric}`);
  lines.push('');

  if (result.indices.warning) {
    lines.push(`⚠ Warning: ${result.indices.warning}`);
    lines.push('');
  }

  lines.push('-'.repeat(80));
  lines.push('PARAMETER RANKING BY TOTAL-ORDER INDEX (Sᵀ)');
  lines.push('-'.repeat(80));
  lines.push('');
  lines.push(`${'Parameter'.padEnd(45)} ${'S₁'.padStart(8)} ${'Sᵀ'.padStart(8)} ${'Interpretation'}`);
  lines.push('-'.repeat(80));

  const sorted = Object.keys(result.indices.firstOrder)
    .map(key => ({
      key,
      first: result.indices.firstOrder[key] ?? 0,
      total: result.indices.totalOrder[key] ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  for (const item of sorted) {
    const name = formatParameterName(item.key);
    const display = name.length > 43 ? name.substring(0, 40) + '...' : name;
    const interpretation = interpretInfluence(item.total);
    lines.push(`${display.padEnd(45)} ${item.first.toFixed(4).padStart(8)} ${item.total.toFixed(4).padStart(8)} ${interpretation}`);
  }

  lines.push('');

  if (result.confidence) {
    lines.push('-'.repeat(80));
    lines.push('95% CONFIDENCE INTERVALS (bootstrap)');
    lines.push('-'.repeat(80));
    lines.push('');
    lines.push(`${'Parameter'.padEnd(35)} ${'S₁ 95% CI'.padStart(20)} ${'Sᵀ 95% CI'.padStart(20)}`);
    lines.push('-'.repeat(80));

    for (const item of sorted) {
      const name = formatParameterName(item.key);
      const display = name.length > 33 ? name.substring(0, 30) + '...' : name;
      const s1ci = result.confidence.firstOrder[item.key];
      const stci = result.confidence.totalOrder[item.key];
      const s1range = `[${s1ci.lower.toFixed(3)}, ${s1ci.upper.toFixed(3)}]`;
      const strange = `[${stci.lower.toFixed(3)}, ${stci.upper.toFixed(3)}]`;
      lines.push(`${display.padEnd(35)} ${s1range.padStart(20)} ${strange.padStart(20)}`);
    }

    lines.push('');
  }

  lines.push('-'.repeat(80));
  lines.push('INTERACTION ANALYSIS (Sᵀ - S₁)');
  lines.push('-'.repeat(80));
  lines.push('');
  lines.push(`${'Parameter'.padEnd(45)} ${'Interaction'.padStart(12)} ${'Strength'}`);
  lines.push('-'.repeat(80));

  for (const item of sorted) {
    const interaction = item.total - item.first;
    const name = formatParameterName(item.key);
    const display = name.length > 43 ? name.substring(0, 40) + '...' : name;
    let strength = 'None';
    if (interaction > 0.3) strength = 'Strong';
    else if (interaction > 0.1) strength = 'Moderate';
    else if (interaction > 0.05) strength = 'Weak';
    lines.push(`${display.padEnd(45)} ${interaction.toFixed(4).padStart(12)} ${strength}`);
  }

  lines.push('');

  lines.push('='.repeat(80));
  lines.push('INTERPRETATION GUIDE');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push('S₁ (first-order index): Direct contribution of parameter to output variance');
  lines.push('Sᵀ (total-order index): Total contribution including all interactions');
  lines.push('');
  lines.push('Sᵀ - S₁ ≈ interaction strength (higher = more interactions with other parameters)');
  lines.push('');
  lines.push('Influence levels:');
  lines.push('  > 0.5  : Very strong influence');
  lines.push('  0.2-0.5: Strong influence');
  lines.push('  0.1-0.2: Moderate influence');
  lines.push('  < 0.1  : Weak influence');
  lines.push('');

  return lines.join('\n');
}

function validateIshigami(lobos) {
  console.log('Validating with Ishigami function...');
  console.log('');

  const N = 1024;
  const ranges = [
    { name: 'x1', min: -Math.PI, max: Math.PI },
    { name: 'x2', min: -Math.PI, max: Math.PI },
    { name: 'x3', min: -Math.PI, max: Math.PI },
  ];

  const skip = 100;
  const sequence = new lobos.Sobol(3, { params: 'new-joe-kuo-6.1000', resolution: 32 });
  sequence.take(skip);
  const X_unit = sequence.take(N);
  const sequence2 = new lobos.Sobol(3, { params: 'new-joe-kuo-6.1000', resolution: 32 });
  sequence2.take(skip + 100000);
  const B_unit = sequence2.take(N);

  const scale = (unitRow, rangeList) => {
    const result = {};
    for (let i = 0; i < rangeList.length; i++) {
      result[rangeList[i].name] = rangeList[i].min + unitRow[i] * (rangeList[i].max - rangeList[i].min);
    }
    return result;
  };

  const X = X_unit.map(row => scale(row, ranges));
  const B = B_unit.map(row => scale(row, ranges));

  const A_x1 = X.map((xRow, n) => ({ ...xRow, x1: B[n].x1 }));
  const A_x2 = X.map((xRow, n) => ({ ...xRow, x2: B[n].x2 }));
  const A_x3 = X.map((xRow, n) => ({ ...xRow, x3: B[n].x3 }));

  const fX = X.map(row => ishigami([row.x1, row.x2, row.x3]));
  const fB = B.map(row => ishigami([row.x1, row.x2, row.x3]));
  const fA = {
    x1: A_x1.map(row => ishigami([row.x1, row.x2, row.x3])),
    x2: A_x2.map(row => ishigami([row.x1, row.x2, row.x3])),
    x3: A_x3.map(row => ishigami([row.x1, row.x2, row.x3])),
  };

  const result = computeSobolIndicesSaltelli({ fX, fB, fA }, ['x1', 'x2', 'x3']);

  console.log('Ishigami Function Validation (N=1024)');
  console.log('');
  console.log(`${'Parameter'.padEnd(10)} ${'S₁ computed'.padStart(12)} ${'S₁ analytical'.padStart(14)} ${'Error'.padStart(10)}`);
  console.log('-'.repeat(50));
  for (const key of ['x1', 'x2', 'x3']) {
    const computed = result.firstOrder[key] ?? 0;
    const idx = key === 'x1' ? 0 : key === 'x2' ? 1 : 2;
    const analytical = ISHIGAMI_ANALYTICAL.firstOrder[idx];
    const error = Math.abs(computed - analytical);
    console.log(`${key.padEnd(10)} ${computed.toFixed(4).padStart(12)} ${analytical.toFixed(4).padStart(14)} ${error.toFixed(4).padStart(10)}`);
  }

  console.log('');
  console.log(`${'Parameter'.padEnd(10)} ${'Sᵀ computed'.padStart(12)} ${'Sᵀ analytical'.padStart(14)} ${'Error'.padStart(10)}`);
  console.log('-'.repeat(50));
  for (const key of ['x1', 'x2', 'x3']) {
    const computed = result.totalOrder[key] ?? 0;
    const idx = key === 'x1' ? 0 : key === 'x2' ? 1 : 2;
    const analytical = ISHIGAMI_ANALYTICAL.totalOrder[idx];
    const error = Math.abs(computed - analytical);
    console.log(`${key.padEnd(10)} ${computed.toFixed(4).padStart(12)} ${analytical.toFixed(4).padStart(14)} ${error.toFixed(4).padStart(10)}`);
  }

  console.log('');
  console.log('Validation complete. Errors should be < 0.05 for N=1024.');
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--validate') {
    const lobos = await import('lobos');
    validateIshigami(lobos);
    return;
  }

  if (args.length < 1) {
    console.log('Usage: node scripts/saltelli-analysis.mjs <experiment-dir> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --metric <name>     Output metric (default: finalPopulation)');
    console.log('  --bootstrap <n>     Bootstrap samples for confidence intervals (default: 1000)');
    console.log('  --output <file>     Write JSON report to file');
    console.log('  --text <file>       Write text report to file');
    console.log('  --validate          Run Ishigami function validation');
    process.exit(1);
  }

  const expDir = path.resolve(args[0]);

  const manifestPath = path.join(expDir, 'saltelli-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const resultsPath = path.join(expDir, 'results.json');
  if (!fs.existsSync(resultsPath)) {
    console.error(`Results not found: ${resultsPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const experiments = parseResultsJson(resultsData);

  let metric = 'finalPopulation';
  let bootstrapSamples = 1000;
  let outputFile = null;
  let textFile = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--metric' && args[i + 1]) {
      metric = args[i + 1];
      i++;
    } else if (args[i] === '--bootstrap' && args[i + 1]) {
      bootstrapSamples = parseInt(args[i + 1]) || 1000;
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--text' && args[i + 1]) {
      textFile = args[i + 1];
      i++;
    }
  }

  console.log(`Analyzing Saltelli experiment: ${manifest.preset}`);
  console.log(`Sample size: ${manifest.sampleSize}, Parameters: ${manifest.parameterCount}`);
  console.log(`Metric: ${metric}, Bootstrap samples: ${bootstrapSamples}`);
  console.log('');

  const { fX, fB, fA, parameterKeys } = buildSaltelliOutputs(experiments, manifest);

  const result = bootstrapSobolIndices({ fX, fB, fA }, parameterKeys, bootstrapSamples);

  const report = {
    method: 'sobol-saltelli',
    preset: manifest.preset,
    sampleSize: manifest.sampleSize,
    parameterCount: manifest.parameterCount,
    metric,
    indices: result.indices,
    confidence: result.confidence,
    bootstrapSamples: result.bootstrapSamples,
  };

  if (outputFile) {
    const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(expDir, outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Wrote JSON report to ${outputPath}`);
  }

  const textReport = generateReportText(result, manifest, metric);

  if (textFile) {
    const textPath = path.isAbsolute(textFile) ? textFile : path.join(expDir, textFile);
    fs.writeFileSync(textPath, textReport);
    console.log(`Wrote text report to ${textPath}`);
  }

  console.log('');
  console.log(textReport);
}

main().catch(console.error);
