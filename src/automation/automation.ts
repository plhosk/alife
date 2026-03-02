import { AutomationPreset, ExperimentConfig, ProgressInfo, AutomationStatus, ScreenshotData, DownloadProgressInfo } from './types';
import { createExperimentConfigs, PRESETS, getVariedParameters } from './automationPresets';
import { ExperimentRunner } from './experiment';
import { ResultsAggregator } from './results';
import { MosaicGenerator } from './mosaic';
import { buildExportBaseName, downloadBlob } from './download';
import { EnvironmentChannelId, PERFORMANCE_CONTROL_CONSTANTS } from '../types';
import JSZip from 'jszip';

export { PRESETS };

export class AutomationController {
  private preset: AutomationPreset | null = null;
  private experiments: ExperimentConfig[] = [];
  private currentRunner: ExperimentRunner | null = null;
  private currentIndex: number = 0;
  private results: ResultsAggregator;
  private mosaic: MosaicGenerator;
  private status: AutomationStatus = 'idle';
  private canvas: HTMLCanvasElement | null = null;
  private allScreenshots: ScreenshotData[] = [];
  private startTimeMs: number = 0;
  private onStartCallback: (() => void) | null = null;
  private onStopCallback: (() => void) | null = null;
  private onProgressCallback: ((progress: ProgressInfo) => void) | null = null;
  private onDownloadProgressCallback: ((progress: DownloadProgressInfo) => void) | null = null;
  private currentSpeedMultiplier: number = 1;
  private environmentOverlayChannel: EnvironmentChannelId | 'none' = 'none';

  constructor() {
    this.results = new ResultsAggregator();
    this.mosaic = new MosaicGenerator();
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  private clearCurrentRunner(): void {
    if (!this.currentRunner) {
      return;
    }
    this.currentRunner.dispose();
    this.currentRunner = null;
  }

  selectPreset(preset: AutomationPreset): void {
    if (this.status === 'running') {
      return;
    }

    this.clearCurrentRunner();
    this.preset = preset;
    this.experiments = createExperimentConfigs(preset);
    this.currentIndex = 0;
    this.status = 'idle';
    this.allScreenshots = [];
    this.mosaic.clear();
  }

  start(): void {
    if (!this.preset || this.experiments.length === 0 || !this.canvas) {
      return;
    }

    if (this.status === 'running') {
      return;
    }

    this.clearCurrentRunner();
    this.status = 'running';
    this.currentIndex = 0;
    this.startTimeMs = Date.now();
    this.allScreenshots = [];
    this.mosaic.clear();
    this.currentSpeedMultiplier = PERFORMANCE_CONTROL_CONSTANTS.maxSpeedMultiplier;
    this.results.start(this.preset.name);
    this.startNextExperiment();

    if (this.onStartCallback) {
      this.onStartCallback();
    }
  }

  stop(): void {
    this.status = 'idle';
    this.clearCurrentRunner();

    if (this.onStopCallback) {
      this.onStopCallback();
    }
  }

  async step(): Promise<void> {
    if (this.status !== 'running' || !this.currentRunner) {
      return;
    }

    // this.currentRunner.step();

    this.currentRunner.render();

    if (this.onProgressCallback) {
      this.onProgressCallback(this.getProgress());
    }

    if (this.currentRunner.isComplete()) {
      this.allScreenshots.push(...await this.currentRunner.getScreenshots());

      if (this.currentIndex < this.experiments.length - 1) {
        this.currentIndex++;
        this.startNextExperiment();
      } else {
        this.complete();
      }
    }
  }

  private startNextExperiment(): void {
    if (!this.canvas || this.currentIndex >= this.experiments.length) {
      return;
    }

    this.clearCurrentRunner();
    this.currentSpeedMultiplier = PERFORMANCE_CONTROL_CONSTANTS.maxSpeedMultiplier;
    const config = this.experiments[this.currentIndex];
    this.currentRunner = new ExperimentRunner(config, this.canvas, this.results);
    this.currentRunner.setEnvironmentOverlayChannel(this.environmentOverlayChannel);
    this.currentRunner.initialize();
  }

  setEnvironmentOverlayChannel(channel: EnvironmentChannelId | 'none'): void {
    this.environmentOverlayChannel = channel;
    this.currentRunner?.setEnvironmentOverlayChannel(channel);
  }

  private complete(): void {
    this.status = 'completed';
    this.clearCurrentRunner();
    this.results.complete();

    if (this.preset && this.preset.generateMosaic && this.allScreenshots.length > 0) {
      for (const screenshot of this.allScreenshots) {
        this.mosaic.addScreenshot(screenshot);
      }
    }

    if (this.onStopCallback) {
      this.onStopCallback();
    }
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  getStatus(): AutomationStatus {
    return this.status;
  }

  getProgress(): ProgressInfo {
    const currentExperimentTimeSec = this.currentRunner ? this.currentRunner.getElapsedTimeSec() : 0;
    const currentExperimentDurationSec = this.currentRunner ? this.currentRunner.getDurationSec() : 0;
    const automationDtSec = this.currentRunner ? this.currentRunner.getAutomationStepDtSec() : 0;

    return {
      running: this.status === 'running',
      currentIndex: this.currentIndex,
      totalExperiments: this.experiments.length,
      currentExperimentTimeSec,
      currentExperimentDurationSec,
      currentPopulation: this.currentRunner ? this.currentRunner.getStatus().population : 0,
      currentGeneration: this.currentRunner ? this.currentRunner.getStatus().generation : 0,
      automationDtSec,
      completedResults: this.results.getExperimentResults(),
      presetName: this.preset?.name ?? '',
      startTimeMs: this.startTimeMs,
    };
  }

  downloadResults(): void {
    if (this.results.hasExperimentData()) {
      this.results.downloadResults();
    }
  }

  downloadCensus(): void {
    if (this.results.hasCensusData()) {
      this.results.downloadCensus();
    }
  }

  downloadFinalCensus(): void {
    if (this.results.hasFinalCensusData()) {
      this.results.downloadFinalCensus();
    }
  }

  async downloadMosaic(): Promise<void> {
    if (this.mosaic.hasScreenshots() && this.preset) {
      this.emitDownloadProgress(0, 1, 'mosaic');
      try {
        await this.mosaic.generate(this.preset.name, this.startTimeMs, (current, total) => {
          this.emitDownloadProgress(current, total, 'mosaic');
        });
      } finally {
        this.endDownloadProgress();
      }
    }
  }

  async downloadFinalMosaic(): Promise<void> {
    if (this.mosaic.hasFinalScreenshots() && this.preset) {
      this.emitDownloadProgress(0, 1, 'final mosaic');
      try {
        await this.mosaic.generateFinal(this.preset.name, this.startTimeMs, (current, total) => {
          this.emitDownloadProgress(current, total, 'final mosaic');
        });
      } finally {
        this.endDownloadProgress();
      }
    }
  }

  async downloadScreenshots(): Promise<void> {
    if (this.allScreenshots.length === 0) return;

    const zip = new JSZip();
    const total = this.allScreenshots.length + 1;

    this.emitDownloadProgress(0, total, 'screenshots');
    for (let i = 0; i < this.allScreenshots.length; i++) {
      const screenshot = this.allScreenshots[i];
      const base64 = screenshot.imageData.split(',')[1];
      const timeStr = `t${Math.round(screenshot.timeSec)}s`;
      const filename = `${screenshot.experimentId}-${timeStr}.webp`;
      zip.file(filename, base64, { base64: true });
      this.emitDownloadProgress(i + 1, total, 'screenshots');
    }

    this.emitDownloadProgress(this.allScreenshots.length, total, 'compressing');
    const content = await zip.generateAsync({ type: 'blob' });
    const baseName = buildExportBaseName(this.preset?.name, this.startTimeMs);
    downloadBlob(content, `${baseName}-screenshots.zip`);
    this.endDownloadProgress();
  }

  async downloadFinalScreenshots(): Promise<void> {
    const finalScreenshots = this.allScreenshots.filter(s => s.isFinal);
    if (finalScreenshots.length === 0) return;

    const zip = new JSZip();
    const total = finalScreenshots.length + 1;

    this.emitDownloadProgress(0, total, 'final screenshots');
    for (let i = 0; i < finalScreenshots.length; i++) {
      const screenshot = finalScreenshots[i];
      const base64 = screenshot.imageData.split(',')[1];
      const filename = `${screenshot.experimentId}.webp`;
      zip.file(filename, base64, { base64: true });
      this.emitDownloadProgress(i + 1, total, 'final screenshots');
    }

    this.emitDownloadProgress(finalScreenshots.length, total, 'compressing');
    const content = await zip.generateAsync({ type: 'blob' });
    const baseName = buildExportBaseName(this.preset?.name, this.startTimeMs);
    downloadBlob(content, `${baseName}-final-screenshots.zip`);
    this.endDownloadProgress();
  }

  downloadAnalysis(): void {
    if (this.results.hasAnalysisData()) {
      this.results.downloadAnalysis();
    }
  }

  downloadAnalysisSummary(): void {
    if (this.results.hasAnalysisData()) {
      this.results.downloadAnalysisSummary();
    }
  }

  async downloadAll(): Promise<void> {
    const zip = new JSZip();

    const hasResults = this.results.hasExperimentData();
    const hasCensus = this.results.hasCensusData();
    const hasFinalCensus = this.results.hasFinalCensusData();
    const hasMosaic = this.mosaic.hasScreenshots();
    const hasFinalMosaic = this.mosaic.hasFinalScreenshots();
    const hasScreenshots = this.allScreenshots.length > 0;
    const hasAnalysis = this.results.hasAnalysisData();
    const hasAnalysisSummary = this.results.hasAnalysisData();
    
    const stages: string[] = [];
    if (hasResults) stages.push('results');
    if (hasCensus) stages.push('census');
    if (hasFinalCensus) stages.push('final census');
    if (hasMosaic) stages.push('mosaic');
    if (hasFinalMosaic) stages.push('final mosaic');
    if (hasScreenshots) stages.push('screenshots');
    if (hasAnalysis) stages.push('analysis');
    if (hasAnalysisSummary) stages.push('analysis summary');
    stages.push('compressing');

    let currentStep = 0;
    const totalSteps = stages.length;

    this.emitDownloadProgress(currentStep, totalSteps, stages[0] || 'preparing');

    if (hasResults) {
      zip.file('results.json', this.results.getResultsJson());
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasCensus) {
      zip.file('census-all.jsonl', this.results.getCensusJsonl());
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasFinalCensus) {
      zip.file('census-final.jsonl', this.results.getFinalCensusJsonl());
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasMosaic && this.preset) {
      const mosaicBlobs = await this.mosaic.getMosaicBlobs(this.preset.name, (mCurrent, mTotal) => {
        this.emitDownloadProgress(currentStep, totalSteps, `mosaic ${mCurrent}/${mTotal}`);
      });
      const folder = zip.folder('mosaic-all');
      if (folder) {
        for (const { filename, blob } of mosaicBlobs) {
          folder.file(filename, blob);
        }
      }
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasFinalMosaic && this.preset) {
      const finalMosaicBlobs = await this.mosaic.getFinalMosaicBlobs(this.preset.name, (mCurrent, mTotal) => {
        this.emitDownloadProgress(currentStep, totalSteps, `final mosaic ${mCurrent}/${mTotal}`);
      });
      const folder = zip.folder('mosaic-final');
      if (folder) {
        for (const { filename, blob } of finalMosaicBlobs) {
          folder.file(filename, blob);
        }
      }
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasScreenshots) {
      const screenshotsFolder = zip.folder('screenshots');
      if (screenshotsFolder) {
        for (let i = 0; i < this.allScreenshots.length; i++) {
          const screenshot = this.allScreenshots[i];
          const base64 = screenshot.imageData.split(',')[1];
          const timeStr = `t${Math.round(screenshot.timeSec)}s`;
          const filename = `${screenshot.experimentId}-${timeStr}.webp`;
          screenshotsFolder.file(filename, base64, { base64: true });
        }
      }
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasAnalysis) {
      zip.file('analysis.json', this.results.getAnalysisJson());
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    if (hasAnalysisSummary) {
      zip.file('analysis-summary.json', this.results.getAnalysisSummaryJson());
      currentStep++;
      this.emitDownloadProgress(currentStep, totalSteps, stages[currentStep] || 'preparing');
    }

    this.emitDownloadProgress(totalSteps - 1, totalSteps, 'compressing');
    const content = await zip.generateAsync({ type: 'blob' });
    const baseName = buildExportBaseName(this.preset?.name, this.startTimeMs);
    downloadBlob(content, `${baseName}-all.zip`);
    this.endDownloadProgress();
  }

  canDownloadAll(): boolean {
    return this.results.hasExperimentData() || 
           this.results.hasCensusData() || 
           this.mosaic.hasScreenshots() || 
           this.allScreenshots.length > 0;
  }

  hasAnalysis(): boolean {
    return this.results.hasAnalysisData();
  }

  getAnalysisCount(): number {
    return this.results.getExperimentCount();
  }

  hasResults(): boolean {
    return this.results.hasExperimentData();
  }

  hasCensus(): boolean {
    return this.results.hasCensusData();
  }

  hasFinalCensus(): boolean {
    return this.results.hasFinalCensusData();
  }

  hasMosaic(): boolean {
    return this.mosaic.hasScreenshots();
  }

  hasFinalMosaic(): boolean {
    return this.mosaic.hasFinalScreenshots();
  }

  hasScreenshots(): boolean {
    return this.allScreenshots.length > 0;
  }

  hasFinalScreenshots(): boolean {
    return this.allScreenshots.some(s => s.isFinal);
  }

  getResultsCount(): number {
    return this.results.getExperimentCount();
  }

  getCensusCount(): number {
    return this.results.getCensusCount();
  }

  getFinalCensusCount(): number {
    return this.results.getFinalCensusCount();
  }

  getMosaicCount(): number {
    return this.mosaic.getCount();
  }

  getFinalMosaicCount(): number {
    return this.mosaic.getFinalCount();
  }

  getScreenshotsCount(): number {
    return this.allScreenshots.length;
  }

  getFinalScreenshotsCount(): number {
    return this.allScreenshots.filter(s => s.isFinal).length;
  }

  onStart(callback: () => void): void {
    this.onStartCallback = callback;
  }

  onStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  onProgress(callback: (progress: ProgressInfo) => void): void {
    this.onProgressCallback = callback;
  }

  onDownloadProgress(callback: (progress: DownloadProgressInfo) => void): void {
    this.onDownloadProgressCallback = callback;
  }

  private emitDownloadProgress(current: number, total: number, stage: string): void {
    if (this.onDownloadProgressCallback) {
      this.onDownloadProgressCallback({ active: true, current, total, stage });
    }
  }

  private endDownloadProgress(): void {
    if (this.onDownloadProgressCallback) {
      this.onDownloadProgressCallback({ active: false, current: 0, total: 0, stage: '' });
    }
  }

  getPreset(): AutomationPreset | null {
    return this.preset;
  }

  getExperiments(): ExperimentConfig[] {
    return this.experiments;
  }

  getCurrentExperiment(): ExperimentRunner | null {
    return this.currentRunner;
  }

  applyHorizontalAnchorShift(widthDelta: number, anchor: 'center' | 'left' | 'right'): void {
    this.currentRunner?.applyHorizontalAnchorShift(widthDelta, anchor);
  }

  normalizeHorizontalBorderVisibility(): void {
    this.currentRunner?.normalizeHorizontalBorderVisibility();
  }

  normalizeVerticalBorderVisibility(): void {
    this.currentRunner?.normalizeVerticalBorderVisibility();
  }

  getVariedParametersList(): string[] {
    if (!this.preset) return [];
    return getVariedParameters(this.preset);
  }

  getSpeedMultiplier(): number {
    return this.currentSpeedMultiplier;
  }

  adjustSpeed(newSpeedMultiplier: number): void {
    this.currentSpeedMultiplier = newSpeedMultiplier;
  }
}

export const automationController = new AutomationController();
