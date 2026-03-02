import fs from 'node:fs';
import path from 'node:path';

/* eslint-disable no-undef */

function trunc(n) {
  if (n === 0) return 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n);
  if (abs >= 100) return Math.round(n * 10) / 10;
  if (abs >= 10) return Math.round(n * 100) / 100;
  if (abs >= 1) return Math.round(n * 1000) / 1000;
  return Math.round(n * 10000) / 10000;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function variance(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return mean(values.map(value => (value - avg) * (value - avg)));
}

function hashSettings(settings) {
  return Object.entries(settings)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function parseCensusJsonl(jsonlText) {
  const byRunId = new Map();
  if (!jsonlText.trim()) return byRunId;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.runId !== 'string') continue;
    if (!byRunId.has(parsed.runId)) byRunId.set(parsed.runId, []);
    byRunId.get(parsed.runId).push(parsed);
  }
  for (const [, entries] of byRunId) {
    entries.sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0));
  }
  return byRunId;
}

function getFinalCensus(censusData) {
  if (!censusData || censusData.length === 0) return null;
  return censusData[censusData.length - 1];
}

function calculateDefaultCandidateScore(census, finalPopulation, collapsed, populationScale, entropyScale, cullingPressure) {
  if (collapsed || !census) return 0;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const populationNorm = clamp01(finalPopulation / Math.max(1, populationScale));
  const genomeEntropyNorm = clamp01((census.genomeEntropy ?? 0) / Math.max(0.0001, entropyScale));
  const segmentDiversityNorm = clamp01((census.segmentDiversity ?? 0) / 2);

  const segmentBalanceScore = () => {
    if (!census?.segmentPercentages) return 0;
    const p = census.segmentPercentages;
    const parts = [p.Arm ?? 0, p.Att ?? 0, p.Loc ?? 0, p.Pho ?? 0];
    const total = parts.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return 0;
    const normalized = parts.map(value => value / total);
    const l1Distance = normalized.reduce((sum, value) => sum + Math.abs(value - 0.25), 0);
    return clamp01(1 - l1Distance / 1.5);
  };

  const balance = segmentBalanceScore();
  const structuralComplexityNorm = clamp01(((census.meanSegmentsPerEntity ?? 0) - 2) / 6);
  const lineageDepthNorm = clamp01((census.generationMax ?? 0) / 25);
  const complexityFloor = clamp01(structuralComplexityNorm * 0.7 + lineageDepthNorm * 0.3);

  const baseScore = clamp01(
    populationNorm * 0.24
    + genomeEntropyNorm * 0.2
    + segmentDiversityNorm * 0.16
    + balance * 0.2
    + complexityFloor * 0.2
  );

  const cullingPenalty = clamp01(cullingPressure * 1.5);
  return clamp01(baseScore * (1 - cullingPenalty * 0.25));
}

function getCullingPressure(census) {
  if (!census) return 0;
  const totalDeaths = census.totalDeaths ?? 0;
  if (totalDeaths === 0) return 0;
  const cullingDeaths = census.deathsByCulling ?? 0;
  return cullingDeaths / totalDeaths;
}

function extractParameterKeys(parameterSets) {
  if (parameterSets.length === 0) return [];
  const keys = new Set();
  for (const params of parameterSets) {
    for (const key of Object.keys(params)) {
      if (typeof params[key] === 'number') {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

function binValues(values, binCount = 5) {
  const n = values.length;
  if (n < binCount) {
    return values.map(() => 0);
  }

  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const binLabels = new Array(n);
  const binSize = Math.floor(n / binCount);

  for (let b = 0; b < binCount; b++) {
    const start = b * binSize;
    const end = b === binCount - 1 ? n : (b + 1) * binSize;
    for (let j = start; j < end; j++) {
      binLabels[sorted[j].i] = b;
    }
  }

  return binLabels;
}

function computeSobolIndices(samples, outputs, parameterKeys) {
  const n = samples.length;
  const k = parameterKeys.length;

  if (n < 10) {
    return {
      firstOrder: {},
      totalOrder: {},
      warning: 'Insufficient samples for reliable Sobol index estimation',
    };
  }

  const outputVariance = variance(outputs);
  if (outputVariance === 0) {
    const result = { firstOrder: {}, totalOrder: {} };
    for (const key of parameterKeys) {
      result.firstOrder[key] = 0;
      result.totalOrder[key] = 0;
    }
    return { ...result, warning: 'Zero output variance' };
  }

  const firstOrder = {};
  const totalOrder = {};

  const binCount = Math.max(3, Math.min(8, Math.floor(n / 5)));

  for (let i = 0; i < k; i++) {
    const paramKey = parameterKeys[i];
    const paramValues = samples.map(s => s[paramKey] ?? 0);
    const uniqueParamValues = [...new Set(paramValues)];

    if (uniqueParamValues.length < 3) {
      firstOrder[paramKey] = 0;
      totalOrder[paramKey] = 0;
      continue;
    }

    const bins = binValues(paramValues, binCount);
    const binOutputs = new Map();

    for (let j = 0; j < n; j++) {
      const bin = bins[j];
      if (!binOutputs.has(bin)) {
        binOutputs.set(bin, []);
      }
      binOutputs.get(bin).push(outputs[j]);
    }

    const conditionalVariances = [];
    for (const binOutputsArray of binOutputs.values()) {
      if (binOutputsArray.length > 1) {
        conditionalVariances.push(variance(binOutputsArray));
      }
    }

    const meanConditionalVariance = mean(conditionalVariances.length > 0 ? conditionalVariances : [outputVariance]);
    const firstOrderVariance = Math.max(0, outputVariance - meanConditionalVariance);
    firstOrder[paramKey] = firstOrderVariance / outputVariance;

    const sortedIndices = [...Array(n).keys()].sort((a, b) => paramValues[a] - paramValues[b]);
    const windowSize = Math.max(2, Math.floor(n / binCount));
    let totalEffectSum = 0;
    let pairCount = 0;

    for (let j = 0; j < n; j++) {
      const centerIdx = sortedIndices[j];
      const centerParam = paramValues[centerIdx];
      const centerOutput = outputs[centerIdx];

      for (let w = Math.max(0, j - windowSize); w <= Math.min(n - 1, j + windowSize); w++) {
        const otherIdx = sortedIndices[w];
        if (otherIdx !== centerIdx) {
          const otherParam = paramValues[otherIdx];
          const paramDiff = Math.abs(centerParam - otherParam);
          const maxRange = Math.max(...paramValues) - Math.min(...paramValues);
          if (maxRange > 0 && paramDiff / maxRange < 0.15) {
            totalEffectSum += (centerOutput - outputs[otherIdx]) ** 2;
            pairCount++;
          }
        }
      }
    }

    if (pairCount > 0) {
      const meanSquaredDiff = totalEffectSum / pairCount;
      totalOrder[paramKey] = Math.max(0, 0.5 * meanSquaredDiff / outputVariance);
    } else {
      totalOrder[paramKey] = firstOrder[paramKey];
    }

    if (totalOrder[paramKey] < firstOrder[paramKey]) {
      totalOrder[paramKey] = firstOrder[paramKey];
    }

    totalOrder[paramKey] = Math.min(1, totalOrder[paramKey]);
    firstOrder[paramKey] = Math.min(1, firstOrder[paramKey]);
  }

  return {
    firstOrder,
    totalOrder,
  };
}

function computeRankCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return 0;

  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) {
      ranks[sorted[i].i] = i + 1;
    }
    return ranks;
  };

  const xRanks = rank(x);
  const yRanks = rank(y);

  let dSquared = 0;
  for (let i = 0; i < n; i++) {
    const d = xRanks[i] - yRanks[i];
    dSquared += d * d;
  }

  return 1 - (6 * dSquared) / (n * (n * n - 1));
}

function analyzeParameterSignals(samples, outputs, parameterKeys) {
  const signals = [];

  for (const key of parameterKeys) {
    const paramValues = samples.map(s => s[key] ?? 0);

    const popCorr = computeRankCorrelation(paramValues, outputs);
    const absCorr = Math.abs(popCorr);

    let trend = 'mixed';
    if (popCorr >= 0.15) trend = 'up';
    else if (popCorr <= -0.15) trend = 'down';

    let strength = 'weak';
    if (absCorr >= 0.55) strength = 'strong';
    else if (absCorr >= 0.3) strength = 'moderate';

    signals.push({
      parameter: key,
      correlation: trunc(popCorr),
      trend,
      strength,
    });
  }

  return signals.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

function generateSensitivityReport(resultsPayload, censusMap, outputMetrics) {
  const experiments = Array.isArray(resultsPayload.experiments) ? resultsPayload.experiments : [];

  const nonCollapsed = experiments.filter(exp => exp?.summary?.collapseEvent !== true);
  const populationScale = Math.max(1, ...nonCollapsed.map(exp => exp?.summary?.finalPopulation ?? 0));
  const entropyScale = Math.max(
    0.0001,
    ...nonCollapsed.map(exp => {
      const runCensus = censusMap.get(exp.id) ?? [];
      const finalCensus = getFinalCensus(runCensus);
      return finalCensus?.genomeEntropy ?? 0;
    })
  );

  const runs = experiments.map(exp => {
    const runCensus = censusMap.get(exp.id) ?? [];
    const finalCensus = getFinalCensus(runCensus);
    const collapseEvent = exp?.summary?.collapseEvent === true;
    const finalPopulation = exp?.summary?.finalPopulation ?? finalCensus?.population ?? 0;
    const cullingPressure = getCullingPressure(finalCensus);

    let defaultScore = 0;
    if (!collapseEvent && finalCensus) {
      defaultScore = calculateDefaultCandidateScore(
        finalCensus, finalPopulation, collapseEvent, populationScale, entropyScale, cullingPressure, runCensus
      );
    }

    return {
      runId: exp.id,
      settings: exp.settings ?? {},
      settingsHash: hashSettings(exp.settings ?? {}),
      collapseEvent,
      finalCensus,
      censusData: runCensus,
      defaultCandidateScore: defaultScore,
      finalPopulation,
      genomeEntropy: finalCensus?.genomeEntropy ?? 0,
      cullingPressure,
    };
  });

  const parameterSets = runs.map(r => r.settings);
  const parameterKeys = extractParameterKeys(parameterSets);

  if (parameterKeys.length === 0) {
    return {
      warning: 'No numeric parameters found in experiment settings',
      metrics: {},
    };
  }

  const samples = runs.map(r => r.settings);
  const metricValues = {
    defaultCandidateScore: runs.map(r => r.defaultCandidateScore),
    finalPopulation: runs.map(r => r.finalPopulation),
    genomeEntropy: runs.map(r => r.genomeEntropy),
  };

  const metrics = {};

  for (const metricName of outputMetrics) {
    const outputs = metricValues[metricName] ?? runs.map(() => 0);
    const indices = computeSobolIndices(samples, outputs, parameterKeys);
    const signals = analyzeParameterSignals(samples, outputs, parameterKeys);

    metrics[metricName] = {
      firstOrder: indices.firstOrder,
      totalOrder: indices.totalOrder,
      parameterSignals: signals,
      warning: indices.warning,
    };
  }

  const ranking = rankParametersByInfluence(metrics, parameterKeys);

  return {
    metrics,
    ranking,
    parameterKeys,
    sampleCount: runs.length,
  };
}

function rankParametersByInfluence(metrics, parameterKeys) {
  const influence = {};

  for (const key of parameterKeys) {
    let totalInfluence = 0;
    let metricCount = 0;

    for (const metricData of Object.values(metrics)) {
      const totalIdx = metricData.totalOrder?.[key] ?? 0;
      totalInfluence += totalIdx;
      metricCount++;
    }

    influence[key] = {
      avgTotalOrder: metricCount > 0 ? totalInfluence / metricCount : 0,
      byMetric: {},
    };

    for (const [metricName, metricData] of Object.entries(metrics)) {
      influence[key].byMetric[metricName] = {
        firstOrder: metricData.firstOrder?.[key] ?? 0,
        totalOrder: metricData.totalOrder?.[key] ?? 0,
      };
    }
  }

  return Object.entries(influence)
    .sort((a, b) => b[1].avgTotalOrder - a[1].avgTotalOrder)
    .map(([key, data]) => ({
      parameter: key,
      avgTotalOrder: trunc(data.avgTotalOrder),
      byMetric: data.byMetric,
    }));
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

function generateReportText(report) {
  const lines = [];

  lines.push('='.repeat(80));
  lines.push('SOBOL SENSITIVITY ANALYSIS REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Sample count: ${report.sampleCount}`);
  lines.push(`Parameters analyzed: ${report.parameterKeys.length}`);
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('PARAMETER RANKING BY TOTAL-ORDER INDEX (Sᵀ)');
  lines.push('-'.repeat(80));
  lines.push('');
  lines.push(`${'Parameter'.padEnd(45)} ${'Sᵀ (avg)'.padStart(10)} ${'Interpretation'}`);
  lines.push('-'.repeat(80));

  for (const item of report.ranking) {
    const name = formatParameterName(item.parameter);
    const display = name.length > 43 ? name.substring(0, 40) + '...' : name;
    const interpretation = interpretInfluence(item.avgTotalOrder);
    lines.push(`${display.padEnd(45)} ${item.avgTotalOrder.toString().padStart(10)} ${interpretation}`);
  }

  lines.push('');

  for (const [metricName, metricData] of Object.entries(report.metrics)) {
    lines.push('-'.repeat(80));
    lines.push(`METRIC: ${metricName}`);
    lines.push('-'.repeat(80));
    lines.push('');

    if (metricData.warning) {
      lines.push(`⚠ ${metricData.warning}`);
      lines.push('');
    }

    lines.push('First-order indices (S₁) - direct effects:');
    lines.push(`${'Parameter'.padEnd(45)} ${'S₁'}`);
    lines.push('-'.repeat(55));

    const sortedByFirstOrder = report.parameterKeys
      .map(key => ({ key, value: metricData.firstOrder[key] ?? 0 }))
      .sort((a, b) => b.value - a.value);

    for (const { key, value } of sortedByFirstOrder) {
      const name = formatParameterName(key);
      const display = name.length > 43 ? name.substring(0, 40) + '...' : name;
      lines.push(`${display.padEnd(45)} ${(value ?? 0).toFixed(4)}`);
    }

    lines.push('');
    lines.push('Total-order indices (Sᵀ) - including interactions:');
    lines.push(`${'Parameter'.padEnd(45)} ${'Sᵀ'}`);
    lines.push('-'.repeat(55));

    const sortedByTotalOrder = report.parameterKeys
      .map(key => ({ key, value: metricData.totalOrder[key] ?? 0 }))
      .sort((a, b) => b.value - a.value);

    for (const { key, value } of sortedByTotalOrder) {
      const name = formatParameterName(key);
      const display = name.length > 43 ? name.substring(0, 40) + '...' : name;
      lines.push(`${display.padEnd(45)} ${(value ?? 0).toFixed(4)}`);
    }

    lines.push('');
    lines.push('Parameter signals (rank correlation):');
    lines.push(`${'Parameter'.padEnd(40)} ${'Corr'.padStart(8)} ${'Trend'.padStart(10)} ${'Strength'}`);
    lines.push('-'.repeat(70));

    for (const signal of metricData.parameterSignals) {
      const name = formatParameterName(signal.parameter);
      const display = name.length > 38 ? name.substring(0, 35) + '...' : name;
      lines.push(`${display.padEnd(40)} ${signal.correlation.toString().padStart(8)} ${signal.trend.padStart(10)} ${signal.strength}`);
    }

    lines.push('');
  }

  lines.push('='.repeat(80));
  lines.push('INTERPRETATION GUIDE');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push('S₁ (first-order index): Direct contribution of parameter to output variance');
  lines.push('Sᵀ (total-order index): Total contribution including all interactions');
  lines.push('');
  lines.push('Sᵀ - S₁ ≈ interaction strength (higher = more interactions)');
  lines.push('');
  lines.push('Influence levels:');
  lines.push('  > 0.5  : Very strong influence');
  lines.push('  0.2-0.5: Strong influence');
  lines.push('  0.1-0.2: Moderate influence');
  lines.push('  < 0.1  : Weak influence');
  lines.push('');

  return lines.join('\n');
}

function interpretInfluence(value) {
  if (value > 0.5) return 'Very strong';
  if (value > 0.2) return 'Strong';
  if (value > 0.1) return 'Moderate';
  if (value > 0.05) return 'Weak';
  return 'Minimal';
}

function findFile(dirPath, preferredName, suffixName) {
  const preferred = path.join(dirPath, preferredName);
  if (fs.existsSync(preferred)) return preferred;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const match = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .find(name => name.endsWith(suffixName));
  return match ? path.join(dirPath, match) : null;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/sensitivity-analysis.mjs <export-dir> [--output <file>]');
    console.error('');
    console.error('Options:');
    console.error('  --metrics <list>  Comma-separated list of metrics to analyze');
    console.error('                    (default: defaultCandidateScore,finalPopulation,genomeEntropy)');
    console.error('  --output <file>   Write JSON report to file');
    console.error('  --text <file>     Write text report to file');
    process.exit(1);
  }

  const targetDir = args[0];
  const resolvedDir = path.resolve(targetDir);

  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`Not a directory: ${resolvedDir}`);
    process.exit(1);
  }

  const resultsFile = findFile(resolvedDir, 'results.json', '-results.json');
  if (!resultsFile) {
    console.error(`Could not find results file in: ${resolvedDir}`);
    process.exit(1);
  }

  const censusFile = findFile(resolvedDir, 'census-all.jsonl', '-census-all.jsonl');
  const resultsPayload = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const censusText = censusFile ? fs.readFileSync(censusFile, 'utf8') : '';
  const censusMap = parseCensusJsonl(censusText);

  let outputMetrics = ['defaultCandidateScore', 'finalPopulation', 'genomeEntropy'];
  let outputFile = null;
  let textFile = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--metrics' && args[i + 1]) {
      outputMetrics = args[i + 1].split(',').map(m => m.trim());
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--text' && args[i + 1]) {
      textFile = args[i + 1];
      i++;
    }
  }

  console.log(`Analyzing ${resultsPayload?.metadata?.preset ?? 'unknown'} experiment...`);
  console.log(`Sample count: ${resultsPayload?.experiments?.length ?? 0}`);
  console.log(`Metrics: ${outputMetrics.join(', ')}`);
  console.log('');

  const report = generateSensitivityReport(resultsPayload, censusMap, outputMetrics);

  if (outputFile) {
    const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(resolvedDir, outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Wrote JSON report to ${outputPath}`);
  }

  if (textFile) {
    const textPath = path.isAbsolute(textFile) ? textFile : path.join(resolvedDir, textFile);
    const textReport = generateReportText(report);
    fs.writeFileSync(textPath, textReport, 'utf8');
    console.log(`Wrote text report to ${textPath}`);
  }

  const textReport = generateReportText(report);
  console.log('');
  console.log(textReport);
}

main();
