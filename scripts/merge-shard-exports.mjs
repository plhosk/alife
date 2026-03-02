/* global process */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error('Usage: node scripts/merge-shard-exports.mjs --out <output-dir> <shard-dir-1> <shard-dir-2> ...');
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length < 4) {
    usage();
  }

  const outIndex = argv.indexOf('--out');
  if (outIndex === -1 || outIndex === argv.length - 1) {
    usage();
  }

  const outDir = path.resolve(argv[outIndex + 1]);
  const shardDirs = argv
    .filter((_, index) => index !== outIndex && index !== outIndex + 1)
    .map(arg => path.resolve(arg));

  if (shardDirs.length < 2) {
    console.error('Provide at least two shard directories.');
    usage();
  }

  return { outDir, shardDirs };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return;
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    console.error(`Output path is not a directory: ${dirPath}`);
    process.exit(1);
  }
}

function findFile(dirPath, preferredName, suffixName) {
  const preferred = path.join(dirPath, preferredName);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isFile()) {
    return preferred;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const match = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .find(name => name.endsWith(suffixName));

  return match ? path.join(dirPath, match) : null;
}

function parseJsonl(jsonlText) {
  const rows = [];
  if (!jsonlText.trim()) {
    return rows;
  }

  const lines = jsonlText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        rows.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return rows;
}

function sanitizeLabel(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function remapJsonlRunIds(rows, runIdMap) {
  const mapped = [];
  for (const row of rows) {
    const runId = typeof row.runId === 'string' ? row.runId : null;
    if (!runId) {
      continue;
    }
    const newRunId = runIdMap.get(runId);
    if (!newRunId) {
      continue;
    }
    mapped.push({ ...row, runId: newRunId });
  }
  return mapped;
}

function main() {
  const { outDir, shardDirs } = parseArgs(process.argv.slice(2));

  for (const shardDir of shardDirs) {
    if (!fs.existsSync(shardDir) || !fs.statSync(shardDir).isDirectory()) {
      console.error(`Shard path is not a directory: ${shardDir}`);
      process.exit(1);
    }
  }

  ensureDir(outDir);

  const mergedExperiments = [];
  const mergedCensusAll = [];
  const mergedCensusFinal = [];
  const sourceLabels = [];

  for (let i = 0; i < shardDirs.length; i++) {
    const shardDir = shardDirs[i];
    const baseName = path.basename(shardDir);
    const sourceLabel = sanitizeLabel(baseName || `shard-${i + 1}`) || `shard-${i + 1}`;
    sourceLabels.push(sourceLabel);

    const resultsPath = findFile(shardDir, 'results.json', '-results.json');
    if (!resultsPath) {
      console.error(`Missing results file in shard: ${shardDir}`);
      process.exit(1);
    }

    const censusAllPath = findFile(shardDir, 'census-all.jsonl', '-census-all.jsonl');
    const censusFinalPath = findFile(shardDir, 'census-final.jsonl', '-census-final.jsonl');

    const resultsPayload = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const experiments = Array.isArray(resultsPayload.experiments) ? resultsPayload.experiments : [];

    const runIdMap = new Map();
    for (const experiment of experiments) {
      const id = typeof experiment.id === 'string' ? experiment.id : null;
      if (!id) {
        continue;
      }
      const newId = `${sourceLabel}-${id}`;
      runIdMap.set(id, newId);
      mergedExperiments.push({
        ...experiment,
        id: newId,
        sourceShard: sourceLabel,
      });
    }

    if (censusAllPath) {
      const rows = parseJsonl(fs.readFileSync(censusAllPath, 'utf8'));
      mergedCensusAll.push(...remapJsonlRunIds(rows, runIdMap).map(row => ({ ...row, sourceShard: sourceLabel })));
    }

    if (censusFinalPath) {
      const rows = parseJsonl(fs.readFileSync(censusFinalPath, 'utf8'));
      mergedCensusFinal.push(...remapJsonlRunIds(rows, runIdMap).map(row => ({ ...row, sourceShard: sourceLabel })));
    }
  }

  mergedExperiments.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  mergedCensusAll.sort((a, b) => {
    const runCmp = String(a.runId).localeCompare(String(b.runId));
    if (runCmp !== 0) {
      return runCmp;
    }
    const tA = typeof a.timeSec === 'number' ? a.timeSec : 0;
    const tB = typeof b.timeSec === 'number' ? b.timeSec : 0;
    return tA - tB;
  });
  mergedCensusFinal.sort((a, b) => String(a.runId).localeCompare(String(b.runId)));

  const mergedResults = {
    metadata: {
      preset: `Merged shards (${sourceLabels.join(', ')})`,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      totalExperiments: mergedExperiments.length,
    },
    experiments: mergedExperiments,
  };

  fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(mergedResults, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'census-all.jsonl'), `${mergedCensusAll.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  if (mergedCensusFinal.length > 0) {
    fs.writeFileSync(path.join(outDir, 'census-final.jsonl'), `${mergedCensusFinal.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const summaryScriptPath = path.join(scriptDir, 'generate-analysis-summary.mjs');
  const summaryResult = spawnSync(process.execPath, [summaryScriptPath, outDir], { stdio: 'inherit' });
  if (summaryResult.status !== 0) {
    console.error('Merged files were written, but summary generation failed.');
    process.exit(summaryResult.status ?? 1);
  }

  console.log(`Merged ${shardDirs.length} shard exports into ${outDir}`);
  console.log(`Merged runs: ${mergedExperiments.length}`);
}

main();
