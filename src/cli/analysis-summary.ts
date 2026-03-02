import fs from 'fs';
import path from 'path';
import { generateAnalysisSummary, AnalysisSummary } from '../automation/analysis';
import { CensusData, ExperimentResult } from '../automation/types';

function findFile(dirPath: string, preferredName: string, suffixName: string): string | null {
  const preferred = path.join(dirPath, preferredName);
  if (fs.existsSync(preferred)) return preferred;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const match = entries
    .filter((entry: fs.Dirent) => entry.isFile())
    .map((entry: fs.Dirent) => entry.name)
    .find((name: string) => name.endsWith(suffixName));
  return match ? path.join(dirPath, match) : null;
}

function parseCensusJsonl(jsonlText: string): Map<string, CensusData[]> {
  const byRunId = new Map<string, CensusData[]>();
  if (!jsonlText.trim()) return byRunId;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.runId === 'string') {
        if (!byRunId.has(parsed.runId)) byRunId.set(parsed.runId, []);
        byRunId.get(parsed.runId)!.push(parsed);
      }
    } catch {
      continue;
    }
  }
  for (const [, entries] of byRunId) {
    entries.sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0));
  }
  return byRunId;
}

interface ResultsPayload {
  experiments?: Array<{
    id: string;
    settings?: Record<string, unknown>;
    summary?: {
      finalPopulation?: number;
      peakPopulation?: number;
      minPopulation?: number;
      meanDiversity?: number;
      collapseEvent?: boolean;
      collapseTimeSec?: number | null;
      censuses?: number;
    };
  }>;
  metadata?: {
    preset?: string;
  };
}

function buildExperimentResults(resultsPayload: ResultsPayload, censusMap: Map<string, CensusData[]>): ExperimentResult[] {
  const experiments = Array.isArray(resultsPayload.experiments) ? resultsPayload.experiments : [];
  return experiments.map(exp => {
    const censusData = censusMap.get(exp.id) ?? [];
    const finalCensus = censusData.length > 0 ? censusData[censusData.length - 1] : null;
    const collapseEvent = exp?.summary?.collapseEvent === true;
    const finalPopulation = exp?.summary?.finalPopulation ?? finalCensus?.population ?? 0;
    return {
      id: exp.id,
      settings: (exp.settings ?? {}) as ExperimentResult['settings'],
      censusData,
      finalCensus,
      summary: {
        finalPopulation,
        peakPopulation: exp?.summary?.peakPopulation ?? finalPopulation,
        minPopulation: exp?.summary?.minPopulation ?? 0,
        meanDiversity: exp?.summary?.meanDiversity ?? finalCensus?.genomeEntropy ?? 0,
        collapseEvent,
        collapseTimeSec: collapseEvent ? (exp?.summary?.collapseTimeSec ?? null) : null,
        censuses: exp?.summary?.censuses ?? censusData.length,
      },
    };
  });
}

function runCli(): void {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error('Usage: tsx src/cli/analysis-summary.ts <export-dir>');
    process.exit(1);
  }

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
  const resultsPayload: ResultsPayload = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const censusText = censusFile ? fs.readFileSync(censusFile, 'utf8') : '';
  const censusMap = parseCensusJsonl(censusText);
  const experiments = buildExperimentResults(resultsPayload, censusMap);

  const summary: AnalysisSummary = generateAnalysisSummary(experiments, {
    presetName: resultsPayload?.metadata?.preset,
  });

  const outPath = path.join(resolvedDir, 'analysis-summary.json');
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
}

runCli();
