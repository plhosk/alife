import { Simulation } from '../simulation';
import { Camera, Config, Entity, EnvironmentChannelId, FoodIncomeBreakdown, SIMULATION_TIMING_CONSTANTS, Vec2 } from '../types';
import { ExperimentConfig, CensusData, ScreenshotData, AutomationPreset } from './types';
import { collectCensus, hashSettings } from './census';
import { Renderer } from '../renderer';
import { createExperimentResult, ResultsAggregator } from './results';
import { getVariedParameters, formatParameterName, formatParameterValue } from './automationPresets';
import { EnvironmentField } from '../environmentField';

export interface ExperimentStatus {
  complete: boolean;
  timeSec: number;
  population: number;
  generation: number;
}

export class ExperimentRunner {
  private simulation: Simulation;
  private config: ExperimentConfig;
  private renderer: Renderer;
  private elapsedTimeSec: number = 0;
  private lastCensusTimeSec: number = 0;
  private lastScreenshotTimeSec: number = 0;
  private completed: boolean = false;
  private censusData: CensusData[] = [];
  private screenshots: ScreenshotData[] = [];
  private pendingScreenshots: Promise<void>[] = [];
  private settingsHash: string;
  private variedSettings: Record<string, number>;
  private resultsAggregator: ResultsAggregator;

  private screenshotCanvas: HTMLCanvasElement | null = null;

  constructor(
    experimentConfig: ExperimentConfig,
    canvas: HTMLCanvasElement,
    resultsAggregator: ResultsAggregator
  ) {
    this.config = experimentConfig;

    this.simulation = new Simulation(experimentConfig.settings);
    this.simulation.setShowFlashEffects(false);
    this.renderer = new Renderer(canvas);
    this.renderer.setSpeedMultiplier(1);
    this.renderer.setShowFlashEffects(false);

    this.settingsHash = hashSettings(experimentConfig.settings);
    this.variedSettings = this.extractVariedSettings();
    this.resultsAggregator = resultsAggregator;
  }

  private extractVariedSettings(): Record<string, number> {
    const varied: Record<string, number> = {};
    const preset: AutomationPreset = {
      name: this.config.presetName,
      description: '',
      durationSec: this.config.durationSec,
      censusIntervalSec: this.config.censusIntervalSec,
      screenshotIntervalSec: this.config.screenshotIntervalSec,
      generateMosaic: false,
      sameRunCount: 1,
      parameterSets: [this.config.settings],
    };
    const variedParams = getVariedParameters(preset);

    for (const param of variedParams) {
      const value = this.config.settings[param as keyof Config];
      if (typeof value === 'number') {
        varied[formatParameterName(param)] = parseFloat(formatParameterValue(param, value));
      }
    }

    return varied;
  }

  initialize(): void {
    this.simulation.initialize();
    if (this.config.settings.enabledSegmentTypes) {
      this.simulation.setEnabledSegmentTypes(this.config.settings.enabledSegmentTypes);
    }
    this.renderer.resize();
    this.renderer.centerCamera(this.simulation.config.worldWidth, this.simulation.config.worldHeight);
    this.elapsedTimeSec = 0;
    this.lastCensusTimeSec = 0;
    this.lastScreenshotTimeSec = 0;
    this.completed = false;
    this.censusData = [];
    this.screenshots = [];
    this.pendingScreenshots = [];
  }

  step(simDtSec: number): void {
    if (this.completed) {
      return;
    }

    this.simulation.step(simDtSec);
    this.elapsedTimeSec += simDtSec;

    const shouldComplete = this.elapsedTimeSec >= this.config.durationSec;

    if (!shouldComplete) {
      if (this.elapsedTimeSec - this.lastCensusTimeSec >= this.config.censusIntervalSec) {
        this.takeCensus(false);
        this.lastCensusTimeSec = this.elapsedTimeSec;
      }

      if (this.config.screenshotIntervalSec > 0 &&
          this.elapsedTimeSec - this.lastScreenshotTimeSec >= this.config.screenshotIntervalSec) {
        this.pendingScreenshots.push(this.takeScreenshot(false));
        this.lastScreenshotTimeSec = this.elapsedTimeSec;
      }
    }

    if (shouldComplete) {
      this.complete();
    }
  }

  render(): void {
    this.renderer.render(this.simulation.entities, this.simulation.config, this.simulation.getEnvironmentField(), this.simulation.getSimulationTimeSec());
  }

  setEnvironmentOverlayChannel(channel: EnvironmentChannelId | 'none'): void {
    this.renderer.setEnvironmentOverlayChannel(channel);
  }

  setShowHealthbars(show: boolean): void {
    this.renderer.setShowHealthbars(show);
  }

  setShowGrid(show: boolean): void {
    this.renderer.setShowGrid(show);
  }

  setShowEnvironmentFootprintDebug(show: boolean): void {
    this.renderer.setShowEnvironmentFootprintDebug(show);
  }

  setSelectedEntity(entity: Entity | null): void {
    this.renderer.setSelectedEntity(entity);
  }

  centerCameraOnAtScreenPoint(worldX: number, worldY: number, screenX: number, screenY: number): void {
    this.renderer.centerCameraOnAtScreenPoint(worldX, worldY, screenX, screenY);
  }

  didDragExceedDeadZone(): boolean {
    return this.renderer.didDragExceedDeadZone();
  }

  screenToWorld(screenX: number, screenY: number): Vec2 {
    return this.renderer.screenToWorld(screenX, screenY);
  }

  applyHorizontalAnchorShift(widthDelta: number, anchor: 'center' | 'left' | 'right'): void {
    this.renderer.applyHorizontalAnchorShift(widthDelta, anchor);
  }

  normalizeHorizontalBorderVisibility(): void {
    this.renderer.normalizeHorizontalBorderVisibility(this.simulation.config.worldWidth);
  }

  normalizeVerticalBorderVisibility(): void {
    this.renderer.normalizeVerticalBorderVisibility(this.simulation.config.worldHeight);
  }

  private takeCensus(isFinal: boolean = false): void {
    const census = collectCensus(
      this.simulation.entities,
      this.config.id,
      this.settingsHash,
      this.elapsedTimeSec,
      {
        totalDeaths: this.simulation.totalDeaths,
        totalBirths: this.simulation.totalBirths,
        birthsByReproduction: this.simulation.birthsByReproduction,
        birthsBySpawning: this.simulation.birthsBySpawning,
        deathsByStarvation: this.simulation.deathsByStarvation,
        deathsByOldAge: this.simulation.deathsByOldAge,
        deathsByAttack: this.simulation.deathsByAttack,
        deathsByCulling: this.simulation.deathsByCulling,
      },
      this.simulation.config.worldWidth,
      this.simulation.config.worldHeight
    );
    this.censusData.push(census);
    this.resultsAggregator.addCensus(census, isFinal);
  }

  private async takeScreenshot(isFinal: boolean = false): Promise<void> {
    const thumbWidth = Math.round(this.simulation.config.worldWidth * 0.5);
    const thumbHeight = Math.round(this.simulation.config.worldHeight * 0.5);

    if (!this.screenshotCanvas) {
      this.screenshotCanvas = document.createElement('canvas');
    }
    this.screenshotCanvas.width = thumbWidth;
    this.screenshotCanvas.height = thumbHeight;

    this.renderer.renderToWorldCanvas(
      this.screenshotCanvas,
      this.simulation.entities,
      this.simulation.config
    );

    const rawImageData = this.screenshotCanvas.toDataURL('image/webp', 0.9);

    const screenshotData: ScreenshotData = {
      experimentId: this.config.id,
      timeSec: this.elapsedTimeSec,
      settings: this.config.settings,
      population: this.simulation.getPopulation(),
      generation: this.simulation.generation,
      imageData: rawImageData,
      width: thumbWidth,
      height: thumbHeight,
      variedSettings: this.variedSettings,
      isFinal,
    };

    this.screenshots.push(screenshotData);
  }

  private complete(): void {
    this.completed = true;

    if (this.elapsedTimeSec > this.lastCensusTimeSec) {
      this.takeCensus(true);
    }

    if (this.config.screenshotIntervalSec > 0 &&
        this.elapsedTimeSec > this.lastScreenshotTimeSec) {
      this.pendingScreenshots.push(this.takeScreenshot(true));
    }

    const result = createExperimentResult(
      this.config.id,
      this.config.settings,
      this.censusData,
      {
        settingsHash: this.settingsHash,
        settingsGroupIndex: this.config.settingsGroupIndex,
        repeatIndex: this.config.repeatIndex,
        repeatCount: this.config.repeatCount,
        presetName: this.config.presetName,
        durationSec: this.config.durationSec,
        censusIntervalSec: this.config.censusIntervalSec,
      }
    );
    this.resultsAggregator.addExperimentResult(result);
  }

  getStatus(): ExperimentStatus {
    return {
      complete: this.completed,
      timeSec: this.elapsedTimeSec,
      population: this.simulation.getPopulation(),
      generation: this.simulation.generation,
    };
  }

  getQueuedCount(): number {
    return this.simulation.getQueuedCount();
  }

  getMedianAgeMs(): number {
    return this.simulation.getMedianAgeMs();
  }

  isComplete(): boolean {
    return this.completed;
  }

  getElapsedTimeSec(): number {
    return this.elapsedTimeSec;
  }

  getDurationSec(): number {
    return this.config.durationSec;
  }

  getAutomationStepDtSec(): number {
    const stepDtSec = this.config.settings.automationStepDtSec;
    if (typeof stepDtSec === 'number' && Number.isFinite(stepDtSec) && stepDtSec > 0) {
      return stepDtSec;
    }
    return SIMULATION_TIMING_CONSTANTS.automationStepDtSec;
  }

  async getScreenshots(): Promise<ScreenshotData[]> {
    await Promise.all(this.pendingScreenshots);
    this.pendingScreenshots = [];
    return this.screenshots;
  }

  getId(): string {
    return this.config.id;
  }

  getSettingsSummary(): string {
    const entries = Object.entries(this.variedSettings)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v}`);
    return entries.join(' ') + (Object.keys(this.variedSettings).length > 3 ? '...' : '');
  }

  getSettings(): Readonly<ExperimentConfig['settings']> {
    return this.config.settings;
  }

  getCamera(): Camera {
    return this.renderer.getCamera();
  }

  getWorldSize(): { width: number; height: number } {
    return {
      width: this.simulation.config.worldWidth,
      height: this.simulation.config.worldHeight,
    };
  }

  getConfig(): Config {
    return this.simulation.config;
  }

  getEntities(): Entity[] {
    return this.simulation.entities;
  }

  getEntityById(entityId: number): Entity | null {
    return this.simulation.entities.find((entity) => entity.id === entityId) ?? null;
  }

  startTracking(entityId: number): void {
    this.simulation.startTracking(entityId);
  }

  stopTracking(): void {
    this.simulation.stopTracking();
  }

  getIncomeStats(): FoodIncomeBreakdown | null {
    return this.simulation.getIncomeStats();
  }

  getLivingRelatives(entityId: number): Array<{ entity: Entity; relationship: string }> {
    return this.simulation.getLivingRelatives(entityId);
  }

  getEnvironmentField(): EnvironmentField {
    return this.simulation.getEnvironmentField();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
