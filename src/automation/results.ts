import { ExperimentResult, CensusData, AutomationExperimentSettings } from './types';
import { generateAnalysis, generateAnalysisSummary, AnalysisOutput, AnalysisSummary } from './analysis/index';
import { buildExportBaseName, downloadBlob } from './download';

function trunc(n: number): number {
  if (n === 0) return 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n);
  if (abs >= 100) return Math.round(n * 10) / 10;
  if (abs >= 10) return Math.round(n * 100) / 100;
  if (abs >= 1) return Math.round(n * 1000) / 1000;
  return Math.round(n * 10000) / 10000;
}

function truncObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'number') return trunc(obj) as T;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => truncObject(v)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = truncObject(value);
  }
  return result as T;
}

export class ResultsAggregator {
  private censusEntries: CensusData[] = [];
  private finalCensusEntries: CensusData[] = [];
  private experimentResults: ExperimentResult[] = [];
  private presetName: string = '';
  private startTimeMs: number = 0;
  private endTimeMs: number = 0;

  start(presetName: string): void {
    this.presetName = presetName;
    this.startTimeMs = Date.now();
    this.censusEntries = [];
    this.finalCensusEntries = [];
    this.experimentResults = [];
  }

  addCensus(data: CensusData, isFinal: boolean = false): void {
    this.censusEntries.push(data);
    if (isFinal) {
      this.finalCensusEntries.push(data);
    }
  }

  addExperimentResult(result: ExperimentResult): void {
    this.experimentResults.push(result);
  }

  complete(): void {
    this.endTimeMs = Date.now();
  }

  downloadCensus(): void {
    if (this.censusEntries.length === 0) return;

    const baseName = buildExportBaseName(this.presetName, this.startTimeMs);
    const jsonl = this.censusEntries.map(e => JSON.stringify(truncObject(e))).join('\n');
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    downloadBlob(blob, `${baseName}-census-all.jsonl`);
  }

  downloadFinalCensus(): void {
    if (this.finalCensusEntries.length === 0) return;

    const baseName = buildExportBaseName(this.presetName, this.startTimeMs);
    const jsonl = this.finalCensusEntries.map(e => JSON.stringify(truncObject(e))).join('\n');
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    downloadBlob(blob, `${baseName}-census-final.jsonl`);
  }

  downloadResults(): void {
    const baseName = buildExportBaseName(this.presetName, this.startTimeMs);
    const results = truncObject({
      metadata: {
        preset: this.presetName,
        startedAt: new Date(this.startTimeMs).toISOString(),
        completedAt: this.endTimeMs ? new Date(this.endTimeMs).toISOString() : null,
        totalExperiments: this.experimentResults.length,
      },
      experiments: this.experimentResults.map(r => ({
        id: r.id,
        settings: r.settings,
        settingsHash: r.settingsHash,
        settingsGroupIndex: r.settingsGroupIndex,
        repeatIndex: r.repeatIndex,
        repeatCount: r.repeatCount,
        presetName: r.presetName,
        durationSec: r.durationSec,
        censusIntervalSec: r.censusIntervalSec,
        summary: r.summary,
        finalCensus: r.finalCensus,
      })),
    });

    const json = JSON.stringify(results, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${baseName}-results.json`);
  }

  getCensusCount(): number {
    return this.censusEntries.length;
  }

  getFinalCensusCount(): number {
    return this.finalCensusEntries.length;
  }

  getExperimentCount(): number {
    return this.experimentResults.length;
  }

  getLastUpdateTimeMs(): number {
    if (this.censusEntries.length > 0) {
      return Date.now();
    }
    return this.startTimeMs || Date.now();
  }

  hasCensusData(): boolean {
    return this.censusEntries.length > 0;
  }

  hasFinalCensusData(): boolean {
    return this.finalCensusEntries.length > 0;
  }

  hasExperimentData(): boolean {
    return this.experimentResults.length > 0;
  }

  getExperimentResults(): ExperimentResult[] {
    return this.experimentResults;
  }

  getCensusData(): CensusData[] {
    return this.censusEntries;
  }

  getAnalysis(): AnalysisOutput | null {
    if (this.experimentResults.length === 0) return null;
    return generateAnalysis(this.experimentResults);
  }

  getAnalysisSummary(): AnalysisSummary | null {
    if (this.experimentResults.length === 0) return null;
    return generateAnalysisSummary(this.experimentResults, {
      presetName: this.presetName || 'unknown',
    });
  }

  getPresetName(): string {
    return this.presetName;
  }

  getStartTimeMs(): number {
    return this.startTimeMs;
  }

  getResultsJson(): string {
    const results = truncObject({
      metadata: {
        preset: this.presetName,
        startedAt: new Date(this.startTimeMs).toISOString(),
        completedAt: this.endTimeMs ? new Date(this.endTimeMs).toISOString() : null,
        totalExperiments: this.experimentResults.length,
      },
      experiments: this.experimentResults.map(r => ({
        id: r.id,
        settings: r.settings,
        settingsHash: r.settingsHash,
        settingsGroupIndex: r.settingsGroupIndex,
        repeatIndex: r.repeatIndex,
        repeatCount: r.repeatCount,
        presetName: r.presetName,
        durationSec: r.durationSec,
        censusIntervalSec: r.censusIntervalSec,
        summary: r.summary,
        finalCensus: r.finalCensus,
      })),
    });
    return JSON.stringify(results, null, 2);
  }

  getCensusJsonl(): string {
    return this.censusEntries.map(e => JSON.stringify(truncObject(e))).join('\n');
  }

  getFinalCensusJsonl(): string {
    return this.finalCensusEntries.map(e => JSON.stringify(truncObject(e))).join('\n');
  }

  getAnalysisJson(): string {
    const analysis = this.getAnalysis();
    if (!analysis) return '';
    return JSON.stringify(analysis, null, 2);
  }

  getAnalysisSummaryJson(): string {
    const summary = this.getAnalysisSummary();
    if (!summary) return '';
    return JSON.stringify(summary, null, 2);
  }

  hasAnalysisData(): boolean {
    return this.experimentResults.length > 0 && this.finalCensusEntries.length > 0;
  }

  downloadAnalysis(): void {
    const analysis = this.getAnalysis();
    if (!analysis) return;

    const baseName = buildExportBaseName(this.presetName, this.startTimeMs);
    const json = JSON.stringify(analysis, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${baseName}-analysis.json`);
  }

  downloadAnalysisSummary(): void {
    const summary = this.getAnalysisSummary();
    if (!summary) return;

    const baseName = buildExportBaseName(this.presetName, this.startTimeMs);
    const json = JSON.stringify(summary, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${baseName}-analysis-summary.json`);
  }
}

export function createExperimentResult(
  id: string,
  settings: AutomationExperimentSettings,
  censuses: CensusData[],
  metadata?: {
    settingsHash?: string;
    settingsGroupIndex?: number;
    repeatIndex?: number;
    repeatCount?: number;
    presetName?: string;
    durationSec?: number;
    censusIntervalSec?: number;
  }
): ExperimentResult {
  const populations = censuses.map(c => c.population);
  const diversities = censuses.map(c => c.genomeEntropy);

  const finalPopulation = populations.length > 0 ? populations[populations.length - 1] : 0;
  const peakPopulation = populations.length > 0 ? Math.max(...populations) : 0;
  const minPopulation = populations.length > 0 ? Math.min(...populations) : 0;
  const meanDiversity = diversities.length > 0 ? diversities.reduce((a, b) => a + b, 0) / diversities.length : 0;
  const collapseEvent = finalPopulation === 0;
  const finalCensus = censuses.length > 0 ? censuses[censuses.length - 1] : null;
  const firstCollapse = censuses.find(census => census.population === 0);
  const collapseTimeSec = firstCollapse ? firstCollapse.timeSec : null;

  return {
    id,
    settings,
    settingsHash: metadata?.settingsHash,
    settingsGroupIndex: metadata?.settingsGroupIndex,
    repeatIndex: metadata?.repeatIndex,
    repeatCount: metadata?.repeatCount,
    presetName: metadata?.presetName,
    durationSec: metadata?.durationSec,
    censusIntervalSec: metadata?.censusIntervalSec,
    summary: {
      finalPopulation,
      peakPopulation,
      minPopulation,
      meanDiversity,
      collapseEvent,
      collapseTimeSec,
      censuses: censuses.length,
    },
    finalCensus,
    censusData: censuses,
  };
}
