import closeIcon from './icons/close.svg?raw';
import hamburgerIcon from './icons/hamburger.svg?raw';
import resetIcon from './icons/reset.svg?raw';
import { Simulation } from './simulation';
import { Renderer } from './renderer';
import {
  BAR_COLORS,
  Camera,
  Config,
  DEFAULT_CONFIG,
  Entity,
  ENVIRONMENT_CHANNELS,
  EnvironmentChannelId,
  INPUT_CONSTANTS,
  PANEL_CONSTANTS,
  PERFORMANCE_CONTROL_CONSTANTS,
  RENDER_STYLE_CONSTANTS,
  SEGMENT_COLORS,
  SEGMENT_TYPES,
  SIMULATION_TIMING_CONSTANTS,
  SPAWN_CONFIGS,
  SegmentType,
} from './types';
import { EventLog } from './eventlog';
import { generateEntityName } from './entity/naming';
import {
  applyLegendColors,
  bindSlider,
  buildEntityStats,
  buildFamilyMember,
  buildIncomePanel,
  renderSpawnGrid,
  updateSpawnGridDisabledState,
  RelativeInfo,
  sortRelatives,
} from './ui';
import { calculateEnvironmentPhotosynthesisMultiplier, calculatePhotosynthesisMultiplier } from './entity/economy';
import { automationController } from './automation/automation';
import { setupAutomationPanel } from './automationPanel';
import {
  applySliderValue,
  CONFIG_SLIDERS,
  formatSliderValue,
  getSliderInputId,
  getSliderValueId,
  readSliderValue,
  renderConfigSliders,
} from './configSliders';
import { bindSelectControl, CONFIG_SELECT_CONTROLS } from './configSelects';
import { resolveSettingsPresetConfig, SETTINGS_PRESETS, SettingsPreset } from './settingsPresets';
import { segmentTypeState } from './segmentTypeState';

interface FrameMode {
  isAutomation: boolean;
  shouldRunFrame: boolean;
  maximizeStepsPerFrame: boolean;
  isIdleDynamicFrame: boolean;
  targetFrameTimeMs: number;
  stepSimulation: (simDtSec: number) => void;
  finalizeFrame: () => Promise<void>;
  onFrameBudgetExceeded: (stepIndex: number) => void;
}

export class Game {
  private simulation: Simulation;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private running: boolean = true;
  private speed: number = 1;
  private lastTimeMs: number = 0;
  private physicsAccumulatorSec: number = 0;
  private selectedEntity: Entity | null = null;
  private displayedGenome: string = '';
  private lastPreviewedEntityId: number | null = null;
  private frameCount: number = 0;
  private lastUIUpdateTimeMs: number = 0;
  private speedSelect: HTMLSelectElement;
  private speedMultiplierText: HTMLElement;
  private calcTimeFill: HTMLElement;
  private calcTimeIdeal: HTMLElement;
  private calcTimeText: HTMLElement;
  private calcTimePerFrameHistory: number[] = [];
  private smoothedCalcTimeMs: number = 0;
  private dynamicSpeed: boolean = false;
  private dynamicSpeedButton: HTMLButtonElement;
  private dynamicSpeedValue: number = 1;
  private manualSpeed: number = 1;
  private playPause: HTMLButtonElement;
  private lastRenderedRelativeIds: Set<number> = new Set();
  private lastAutomationProgressUpdateMs: number = 0;
  private hasSizedCanvas: boolean = false;
  private automationLockedContainers: HTMLElement[] = [];
  private spawnInitialSeedInput: HTMLInputElement | null = null;
  private spawnEvolutionSeedInput: HTMLInputElement | null = null;
  private spawnInitialSeedText: string = '';
  private spawnEvolutionSeedText: string = '';
  private pacingDebugHistory: { frameDtMs: number; stepsRun: number; accumulatorSec: number; calcTimeMs: number }[] = [];
  private collectPacingDebug: boolean = false;
  private statusPanelVisible: boolean = true;
  private sliderPanelWasOpen: boolean = false;
  private helpPanelWasOpen: boolean = false;
  private automationPanelWasOpen: boolean = false;

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.speedSelect = document.getElementById('speed') as HTMLSelectElement;
    this.speedMultiplierText = document.getElementById('speedMultiplier')!;
    this.dynamicSpeedButton = document.getElementById('turboSpeed') as HTMLButtonElement;
    this.playPause = document.getElementById('playPause') as HTMLButtonElement;
    this.calcTimeFill = document.getElementById('calcTimeFill')!;
    this.calcTimeIdeal = document.getElementById('calcTimeIdeal')!;
    this.calcTimeText = document.getElementById('calcTime')!;
    this.renderer = new Renderer(this.canvas);
    this.simulation = new Simulation();

    this.setSpeed(parseFloat(this.speedSelect.value));
    this.updateDynamicSpeedState();

    this.setupUI();
    this.setupLegends();
    this.setupPreviewCanvas();
    this.setupAutomation();
    this.injectIcons();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.simulation.initialize();
    this.centerCamera();

    this.canvas.addEventListener('click', (e) => this.handleClick(e));
  }

  private resize(anchor: 'center' | 'left' | 'right' = 'center'): void {
    const previousWidth = this.renderer.getLogicalWidth();
    this.renderer.resize();

    if (!this.hasSizedCanvas) {
      this.hasSizedCanvas = true;
      return;
    }

    const widthDelta = this.renderer.getLogicalWidth() - previousWidth;
    if (widthDelta === 0) {
      return;
    }

    this.renderer.applyHorizontalAnchorShift(widthDelta, anchor);
    automationController.applyHorizontalAnchorShift(widthDelta, anchor);

    if (anchor === 'center') {
      const framingBox = this.getFramingBoxSize();
      if (framingBox.height > framingBox.width) {
        this.renderer.normalizeHorizontalBorderVisibility(this.simulation.config.worldWidth);
        automationController.normalizeHorizontalBorderVisibility();
      } else {
        this.renderer.normalizeVerticalBorderVisibility(this.simulation.config.worldHeight);
        automationController.normalizeVerticalBorderVisibility();
      }
    }
  }

  private getFramingBoxSize(): { width: number; height: number } {
    const app = document.getElementById('app');
    const controlPanel = document.getElementById('controlPanel');
    const appWidth = app instanceof HTMLElement ? app.clientWidth : this.renderer.getLogicalWidth();
    const appHeight = app instanceof HTMLElement ? app.clientHeight : this.renderer.getLogicalHeight();
    const controlPanelWidth = controlPanel instanceof HTMLElement ? controlPanel.getBoundingClientRect().width : 0;

    return {
      width: Math.max(1, appWidth - controlPanelWidth),
      height: Math.max(1, appHeight),
    };
  }

  private scrollPanelDockToEnd(): void {
    const panelDock = document.getElementById('panelDock');
    if (panelDock) {
      panelDock.scrollLeft = panelDock.scrollWidth;
    }
  }

  private updateToggleBtnPosition(): void {
    const toggleBtn = document.getElementById('togglePanels');
    const controlPanel = document.getElementById('controlPanel');
    if (!toggleBtn) return;

    let rightPos = 12;
    
    if (controlPanel && !controlPanel.classList.contains('status-panel-hidden')) {
      const scrollbarWidth = controlPanel.offsetWidth - controlPanel.clientWidth;
      rightPos = scrollbarWidth + 12;
    }

    toggleBtn.style.right = `${rightPos}px`;
    toggleBtn.style.transform = '';
  }

  private setupVisualViewportTracking(): void {
    if (!document.getElementById('togglePanels')) return;

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.updateToggleBtnPosition());
      window.visualViewport.addEventListener('scroll', () => this.updateToggleBtnPosition());
    }
    window.addEventListener('scroll', () => this.updateToggleBtnPosition());
    window.addEventListener('resize', () => this.updateToggleBtnPosition());
    this.updateToggleBtnPosition();
  }

  private getActiveCameraState(): { camera: Camera; worldWidth: number; worldHeight: number } {
    const automationExperiment = automationController.isRunning()
      ? automationController.getCurrentExperiment()
      : null;

    if (automationExperiment) {
      const worldSize = automationExperiment.getWorldSize();
      return {
        camera: automationExperiment.getCamera(),
        worldWidth: worldSize.width,
        worldHeight: worldSize.height,
      };
    }

    return {
      camera: this.renderer.getCamera(),
      worldWidth: this.simulation.config.worldWidth,
      worldHeight: this.simulation.config.worldHeight,
    };
  }

  private buildCameraDebugSnapshot(): string {
    const framingBox = this.getFramingBoxSize();
    const { camera, worldWidth, worldHeight } = this.getActiveCameraState();
    const canvasW = this.renderer.getLogicalWidth();
    const canvasH = this.renderer.getLogicalHeight();
    const leftX = (0 - camera.x) * camera.zoom + canvasW / 2;
    const rightX = (worldWidth - camera.x) * camera.zoom + canvasW / 2;
    const topY = (0 - camera.y) * camera.zoom + canvasH / 2;
    const bottomY = (worldHeight - camera.y) * camera.zoom + canvasH / 2;
    const mode = automationController.isRunning() ? 'A' : 'M';

    return [
      `mode=${mode}`,
      `canvas=${canvasW}x${canvasH}`,
      `framing=${Math.round(framingBox.width)}x${Math.round(framingBox.height)}`,
      `zoom=${camera.zoom.toFixed(6)}`,
      `camera=(${camera.x.toFixed(3)}, ${camera.y.toFixed(3)})`,
      `world=${worldWidth}x${worldHeight}`,
      `borders L=${leftX.toFixed(3)} R=${rightX.toFixed(3)} T=${topY.toFixed(3)} B=${bottomY.toFixed(3)}`,
    ].join('\n');
  }

  private buildPacingDebugSnapshot(): string {
    const lines: string[] = [];
    lines.push(`frames=${this.pacingDebugHistory.length}`);
    lines.push(`speed=${this.speed}`);
    lines.push(`dynamicSpeed=${this.dynamicSpeed}`);
    lines.push(`simulationTimeScale=${this.simulation.config.simulationTimeScale}`);
    lines.push('');
    lines.push('frameDtMs\tstepsRun\taccumulatorSec\tcalcTimeMs');

    for (const entry of this.pacingDebugHistory) {
      const accStr = entry.accumulatorSec < 0 ? '-' : entry.accumulatorSec.toFixed(6);
      lines.push(`${entry.frameDtMs.toFixed(2)}\t${entry.stepsRun}\t${accStr}\t${entry.calcTimeMs.toFixed(2)}`);
    }

    return lines.join('\n');
  }

  private createLcgRandom(seed: number): () => number {
    let state = Math.trunc(seed) >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  private createXoshiro128StarStarRandom(seed: number): () => number {
    const rotateLeft = (value: number, shift: number): number => {
      return ((value << shift) | (value >>> (32 - shift))) >>> 0;
    };

    let splitState = Math.trunc(seed) >>> 0;
    const splitMix32Next = (): number => {
      splitState = (splitState + 0x9e3779b9) >>> 0;
      let z = splitState;
      z = Math.imul((z ^ (z >>> 16)) >>> 0, 0x85ebca6b) >>> 0;
      z = Math.imul((z ^ (z >>> 13)) >>> 0, 0xc2b2ae35) >>> 0;
      z = (z ^ (z >>> 16)) >>> 0;
      return z >>> 0;
    };

    const state: [number, number, number, number] = [
      splitMix32Next(),
      splitMix32Next(),
      splitMix32Next(),
      splitMix32Next(),
    ];
    if (state[0] === 0 && state[1] === 0 && state[2] === 0 && state[3] === 0) {
      state[0] = 1;
    }

    return () => {
      const result = Math.imul(rotateLeft(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
      const t = (state[1] << 9) >>> 0;

      state[2] = (state[2] ^ state[0]) >>> 0;
      state[3] = (state[3] ^ state[1]) >>> 0;
      state[1] = (state[1] ^ state[2]) >>> 0;
      state[0] = (state[0] ^ state[3]) >>> 0;
      state[2] = (state[2] ^ t) >>> 0;
      state[3] = rotateLeft(state[3], 11);

      return result / 4294967296;
    };
  }

  private measureRandomGenerator(name: string, nextRandom: () => number, iterations: number): string {
    let checksum = 0;

    for (let i = 0; i < 20000; i++) {
      checksum += nextRandom();
    }

    const startMs = performance.now();
    for (let i = 0; i < iterations; i++) {
      checksum += nextRandom();
    }
    const elapsedMs = Math.max(0.0001, performance.now() - startMs);
    const drawsPerSec = (iterations * 1000) / elapsedMs;
    const nsPerDraw = (elapsedMs * 1_000_000) / iterations;

    return `${name}: ${elapsedMs.toFixed(2)}ms, ${drawsPerSec.toFixed(0)} draws/s, ${nsPerDraw.toFixed(1)} ns/draw, checksum=${checksum.toFixed(3)}`;
  }

  private buildRandomBenchmarkSnapshot(iterations: number): string {
    const safeIterations = Math.max(100000, Math.trunc(iterations));
    const lines = [
      `rng-benchmark iterations=${safeIterations}`,
      this.measureRandomGenerator('Math.random', () => Math.random(), safeIterations),
      this.measureRandomGenerator('LCG(1664525,1013904223)', this.createLcgRandom(123456789), safeIterations),
      this.measureRandomGenerator('xoshiro128**', this.createXoshiro128StarStarRandom(123456789), safeIterations),
    ];
    return lines.join('\n');
  }

  private buildPreviewCanvasesSnapshot(): string {
    const selectedEntityPane = document.getElementById('selectedEntity');
    if (!(selectedEntityPane instanceof HTMLElement)) {
      return JSON.stringify({
        capturedAtIso: new Date().toISOString(),
        error: 'selected entity pane not found',
      }, null, 2);
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const automationExperiment = this.getActiveAutomationExperiment();
    const entities = automationExperiment ? automationExperiment.getEntities() : this.simulation.entities;
    const entitiesById = new Map<number, Entity>(entities.map((entity) => [entity.id, entity]));
    const selectedEntity = this.selectedEntity
      ? entitiesById.get(this.selectedEntity.id) ?? this.selectedEntity
      : null;

    interface CanvasMetadata {
      logicalSize: { width: number; height: number };
      backingSize: { width: number; height: number };
      renderedRect: { width: number; height: number };
      backingScale: { x: number; y: number };
    }

    interface PreviewFitMetadata {
      entityId: number;
      segments: number;
      aabbWorldSize: { width: number; height: number };
      previewSpace: { availableWidth: number; availableHeight: number };
      fitScale: number;
      appliedScale: number;
      cappedByHardMaxZoom: boolean;
      hardMaxPreviewZoom: number;
      hardMaxLineWidth: number;
      lineWidth: number;
    }

    const buildCanvasMetadata = (canvas: HTMLCanvasElement): CanvasMetadata => {
      const logicalWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
      const logicalHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
      const rect = canvas.getBoundingClientRect();
      const backingScaleX = canvas.width / logicalWidth;
      const backingScaleY = canvas.height / logicalHeight;

      return {
        logicalSize: { width: logicalWidth, height: logicalHeight },
        backingSize: { width: canvas.width, height: canvas.height },
        renderedRect: {
          width: Number(rect.width.toFixed(3)),
          height: Number(rect.height.toFixed(3)),
        },
        backingScale: {
          x: Number(backingScaleX.toFixed(4)),
          y: Number(backingScaleY.toFixed(4)),
        },
      };
    };

    const resolvePreviewCaps = (logicalWidth: number, logicalHeight: number): { hardMaxPreviewZoom: number; hardMaxLineWidth: number } => {
      const shortSide = Math.min(logicalWidth, logicalHeight);
      return {
        hardMaxPreviewZoom: shortSide <= 64 ? 2.6 : 5,
        hardMaxLineWidth: shortSide <= 64 ? 4 : RENDER_STYLE_CONSTANTS.previewMaxLineWidth,
      };
    };

    const buildEntityPreviewFit = (
      entity: Entity | null,
      logicalWidth: number,
      logicalHeight: number,
    ): PreviewFitMetadata | null => {
      if (!entity) {
        return null;
      }

      const margin = RENDER_STYLE_CONSTANTS.previewMargin;
      const availableW = Math.max(1, logicalWidth - margin * 2);
      const availableH = Math.max(1, logicalHeight - margin * 2);
      const { hardMaxPreviewZoom, hardMaxLineWidth } = resolvePreviewCaps(logicalWidth, logicalHeight);
      const entityW = Math.max(1, entity.aabbMax.x - entity.aabbMin.x);
      const entityH = Math.max(1, entity.aabbMax.y - entity.aabbMin.y);
      const fitScale = Math.min(availableW / entityW, availableH / entityH);
      const appliedScale = Math.min(fitScale, hardMaxPreviewZoom);
      const lineWidth = Math.max(
        RENDER_STYLE_CONSTANTS.segmentLineWidth,
        Math.min(hardMaxLineWidth, RENDER_STYLE_CONSTANTS.segmentLineWidth * appliedScale)
      );

      return {
        entityId: entity.id,
        segments: entity.segments.length,
        aabbWorldSize: {
          width: Number(entityW.toFixed(4)),
          height: Number(entityH.toFixed(4)),
        },
        previewSpace: {
          availableWidth: Number(availableW.toFixed(4)),
          availableHeight: Number(availableH.toFixed(4)),
        },
        fitScale: Number(fitScale.toFixed(6)),
        appliedScale: Number(appliedScale.toFixed(6)),
        cappedByHardMaxZoom: fitScale > hardMaxPreviewZoom,
        hardMaxPreviewZoom,
        hardMaxLineWidth,
        lineWidth: Number(lineWidth.toFixed(6)),
      };
    };

    const previewCanvas = selectedEntityPane.querySelector('#entityPreview');
    const familyMembers = Array.from(selectedEntityPane.querySelectorAll('.family-member'));
    const familyPreviews = familyMembers.map((member) => {
      const memberElement = member as HTMLElement;
      const canvas = memberElement.querySelector('.family-member-preview');
      const nameElement = memberElement.querySelector('.family-member-name');
      const relationshipElement = memberElement.querySelector('.family-member-relationship');

      return {
        entityId: Number.parseInt(memberElement.dataset.entityId ?? '0', 10) || null,
        name: nameElement?.textContent ?? '',
        relationship: relationshipElement?.textContent ?? '',
        canvas: canvas instanceof HTMLCanvasElement ? buildCanvasMetadata(canvas) : null,
        previewFit: (() => {
          if (!(canvas instanceof HTMLCanvasElement)) {
            return null;
          }
          const entityId = Number.parseInt(memberElement.dataset.entityId ?? '0', 10) || 0;
          const entity = entitiesById.get(entityId) ?? null;
          const logicalWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
          const logicalHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
          return buildEntityPreviewFit(entity, logicalWidth, logicalHeight);
        })(),
      };
    });

    const payload = {
      capturedAtIso: new Date().toISOString(),
      mode: automationExperiment ? 'automation' : 'manual',
      devicePixelRatio: dpr,
      previewRenderConfig: {
        previewMargin: RENDER_STYLE_CONSTANTS.previewMargin,
        minLineWidth: RENDER_STYLE_CONSTANTS.segmentLineWidth,
        maxLineWidth: RENDER_STYLE_CONSTANTS.previewMaxLineWidth,
        smallPreviewBreakpoint: 64,
        hardMaxPreviewZoomSmall: 2.6,
        hardMaxPreviewZoomLarge: 5,
        hardMaxLineWidthSmall: 4,
      },
      selectedEntityPaneVisible: !selectedEntityPane.classList.contains('hidden'),
      selectedEntityId: selectedEntity?.id ?? null,
      selectedPreview: previewCanvas instanceof HTMLCanvasElement
        ? {
          canvas: buildCanvasMetadata(previewCanvas),
          previewFit: buildEntityPreviewFit(
            selectedEntity,
            Math.max(1, Math.round(previewCanvas.clientWidth || previewCanvas.width)),
            Math.max(1, Math.round(previewCanvas.clientHeight || previewCanvas.height)),
          ),
        }
        : null,
      familyPreviewCount: familyPreviews.length,
      familyPreviews,
    };

    return JSON.stringify(payload, null, 2);
  }

  private formatSeedInputValue(seed: number | null | undefined, isInitialSeed: boolean, useStoredText: boolean = true): string {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      return '';
    }
    if (useStoredText) {
      const storedText = isInitialSeed ? this.spawnInitialSeedText : this.spawnEvolutionSeedText;
      if (storedText) {
        return storedText;
      }
    }
    return String(Math.trunc(seed) >>> 0);
  }

  private syncSeedInputsFromActiveContext(): void {
    if (!(this.spawnInitialSeedInput instanceof HTMLInputElement) || !(this.spawnEvolutionSeedInput instanceof HTMLInputElement)) {
      return;
    }

    const activeElement = document.activeElement;
    const isEditingInitialSeed = activeElement === this.spawnInitialSeedInput;
    const isEditingEvolutionSeed = activeElement === this.spawnEvolutionSeedInput;

    const syncInputValue = (input: HTMLInputElement, nextValue: string, isEditing: boolean): void => {
      if (isEditing) {
        return;
      }
      input.value = nextValue;
      const clearBtn = input.nextElementSibling as HTMLButtonElement | null;
      if (clearBtn?.classList.contains('spawn-seed-clear')) {
        clearBtn.classList.toggle('hidden', !nextValue);
      }
    };

    const syncInputActiveState = (input: HTMLInputElement, seed: number | null | undefined): void => {
      const hasFixedSeed = typeof seed === 'number' && Number.isFinite(seed);
      input.classList.toggle('seed-active', hasFixedSeed);
    };

    const automationExperiment = automationController.isRunning()
      ? automationController.getCurrentExperiment()
      : null;

    if (automationExperiment) {
      const settings = automationExperiment.getSettings();
      syncInputValue(this.spawnInitialSeedInput, this.formatSeedInputValue(settings.initialRandomSeed, true, false), isEditingInitialSeed);
      syncInputValue(this.spawnEvolutionSeedInput, this.formatSeedInputValue(settings.evolutionRandomSeed, false, false), isEditingEvolutionSeed);
      syncInputActiveState(this.spawnInitialSeedInput, settings.initialRandomSeed);
      syncInputActiveState(this.spawnEvolutionSeedInput, settings.evolutionRandomSeed);
      return;
    }

    syncInputValue(this.spawnInitialSeedInput, this.formatSeedInputValue(this.simulation.getInitialRandomSeed(), true), isEditingInitialSeed);
    syncInputValue(this.spawnEvolutionSeedInput, this.formatSeedInputValue(this.simulation.getEvolutionRandomSeed(), false), isEditingEvolutionSeed);
    syncInputActiveState(this.spawnInitialSeedInput, this.simulation.getInitialRandomSeed());
    syncInputActiveState(this.spawnEvolutionSeedInput, this.simulation.getEvolutionRandomSeed());
  }

  private getActiveAutomationExperiment(): ReturnType<typeof automationController.getCurrentExperiment> {
    if (!automationController.isRunning()) {
      return null;
    }
    return automationController.getCurrentExperiment();
  }

  private syncRendererVisibilityFlags(): void {
    const showHealthbars = (document.getElementById('showHealthbars') as HTMLInputElement | null)?.checked ?? false;
    const showGrid = (document.getElementById('showGrid') as HTMLInputElement | null)?.checked ?? false;
    const showEnvironmentFootprintDebug = (document.getElementById('showEnvironmentFootprintDebug') as HTMLInputElement | null)?.checked ?? false;
    const showNeuralAndLocomotorActivity = (document.getElementById('showNeuralAndLocomotorActivity') as HTMLInputElement | null)?.checked ?? false;
    const disableFlashEffects = (document.getElementById('disableFlashEffects') as HTMLInputElement | null)?.checked ?? false;

    this.renderer.setShowHealthbars(showHealthbars);
    this.renderer.setShowGrid(showGrid);
    this.renderer.setShowEnvironmentFootprintDebug(showEnvironmentFootprintDebug);
    this.renderer.setShowNeuralAndLocomotorActivity(showNeuralAndLocomotorActivity);
    this.renderer.setShowFlashEffects(!disableFlashEffects);
    this.simulation.setShowFlashEffects(!disableFlashEffects);

    const automationExperiment = this.getActiveAutomationExperiment();
    if (automationExperiment) {
      automationExperiment.setShowHealthbars(showHealthbars);
      automationExperiment.setShowGrid(showGrid);
      automationExperiment.setShowEnvironmentFootprintDebug(showEnvironmentFootprintDebug);
    }
  }

  private syncSelectedEntityOnActiveRenderer(): void {
    const automationExperiment = this.getActiveAutomationExperiment();
    if (automationController.isRunning()) {
      this.renderer.setSelectedEntity(null);
      if (automationExperiment) {
        automationExperiment.setSelectedEntity(this.selectedEntity);
      }
      return;
    }
    this.renderer.setSelectedEntity(this.selectedEntity);
  }

  private startTrackingSelectedEntity(entityId: number): void {
    const automationExperiment = this.getActiveAutomationExperiment();
    if (automationExperiment) {
      automationExperiment.startTracking(entityId);
      return;
    }
    this.simulation.startTracking(entityId);
  }

  private stopTrackingSelectedEntity(): void {
    const automationExperiment = this.getActiveAutomationExperiment();
    if (automationExperiment) {
      automationExperiment.stopTracking();
      return;
    }
    this.simulation.stopTracking();
  }

  private setSelectedEntityHasRelatives(hasRelatives: boolean): void {
    const selectedEntityPane = document.getElementById('selectedEntity');
    if (!(selectedEntityPane instanceof HTMLElement)) {
      return;
    }
    selectedEntityPane.classList.toggle('has-relatives', hasRelatives);
  }

  private setupPreviewCanvas(): void {
    const previewCanvas = document.getElementById('entityPreview') as HTMLCanvasElement;
    const width = Math.max(1, Math.round(previewCanvas.clientWidth || RENDER_STYLE_CONSTANTS.previewCanvasSize));
    const height = Math.max(1, Math.round(previewCanvas.clientHeight || RENDER_STYLE_CONSTANTS.previewCanvasSize));
    previewCanvas.width = width;
    previewCanvas.height = height;
  }

  private centerCamera(): void {
    const framingBox = this.getFramingBoxSize();
    this.renderer.centerCamera(
      this.simulation.config.worldWidth,
      this.simulation.config.worldHeight,
      framingBox.width,
      framingBox.height,
    );
  }

  private centerCameraOnEntity(entity: Entity): void {
    const automationExperiment = this.getActiveAutomationExperiment();
    const camera = automationExperiment ? automationExperiment.getCamera() : this.renderer.getCamera();
    const zoom = camera.zoom;
    const canvasWidth = this.renderer.getLogicalWidth();
    const canvasHeight = this.renderer.getLogicalHeight();
    const entityPadding = 8;
    const edgePadding = 10;
    const panelPadding = 8;
    const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
    const box = {
      left: (entity.aabbMin.x - camera.x) * zoom + canvasWidth / 2 - entityPadding,
      right: (entity.aabbMax.x - camera.x) * zoom + canvasWidth / 2 + entityPadding,
      top: (entity.aabbMin.y - camera.y) * zoom + canvasHeight / 2 - entityPadding,
      bottom: (entity.aabbMax.y - camera.y) * zoom + canvasHeight / 2 + entityPadding,
    };
    const boxWidth = Math.max(0, box.right - box.left);
    const boxHeight = Math.max(0, box.bottom - box.top);
    const baseRegion = {
      left: edgePadding,
      top: edgePadding,
      right: Math.max(edgePadding, canvasWidth - edgePadding),
      bottom: Math.max(edgePadding, canvasHeight - edgePadding),
    };

    const regions: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    const selectedEntityPanel = document.getElementById('selectedEntity');
    if (selectedEntityPanel instanceof HTMLElement && !selectedEntityPanel.classList.contains('hidden')) {
      const canvasRect = this.canvas.getBoundingClientRect();
      const panelRect = selectedEntityPanel.getBoundingClientRect();
      const overlapLeft = Math.max(canvasRect.left, panelRect.left);
      const overlapTop = Math.max(canvasRect.top, panelRect.top);
      const overlapRight = Math.min(canvasRect.right, panelRect.right);
      const overlapBottom = Math.min(canvasRect.bottom, panelRect.bottom);

      if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
        const occluded = {
          left: overlapLeft - canvasRect.left,
          top: overlapTop - canvasRect.top,
          right: overlapRight - canvasRect.left,
          bottom: overlapBottom - canvasRect.top,
        };
        regions.push(
          { left: baseRegion.left, top: baseRegion.top, right: baseRegion.right, bottom: occluded.top - panelPadding },
          { left: baseRegion.left, top: occluded.bottom + panelPadding, right: baseRegion.right, bottom: baseRegion.bottom },
          { left: baseRegion.left, top: baseRegion.top, right: occluded.left - panelPadding, bottom: baseRegion.bottom },
          { left: occluded.right + panelPadding, top: baseRegion.top, right: baseRegion.right, bottom: baseRegion.bottom },
        );
      } else {
        regions.push(baseRegion);
      }
    } else {
      regions.push(baseRegion);
    }

    const fitTranslationToRegion = (region: { left: number; top: number; right: number; bottom: number }): { dx: number; dy: number } | null => {
      const regionWidth = region.right - region.left;
      const regionHeight = region.bottom - region.top;
      if (regionWidth < boxWidth || regionHeight < boxHeight) {
        return null;
      }

      const minLeft = region.left;
      const maxLeft = region.right - boxWidth;
      const minTop = region.top;
      const maxTop = region.bottom - boxHeight;
      const targetLeft = clamp(box.left, minLeft, maxLeft);
      const targetTop = clamp(box.top, minTop, maxTop);

      return {
        dx: targetLeft - box.left,
        dy: targetTop - box.top,
      };
    };

    let bestTranslation: { dx: number; dy: number } | null = null;
    let bestDistanceSq = Infinity;

    for (const region of regions) {
      const translation = fitTranslationToRegion(region);
      if (!translation) continue;
      const distanceSq = translation.dx * translation.dx + translation.dy * translation.dy;
      if (distanceSq < bestDistanceSq) {
        bestTranslation = translation;
        bestDistanceSq = distanceSq;
      }
    }

    if (!bestTranslation) {
      bestTranslation = fitTranslationToRegion(baseRegion);
    }

    if (!bestTranslation) {
      return;
    }

    const currentScreenX = (entity.com.x - camera.x) * zoom + canvasWidth / 2;
    const currentScreenY = (entity.com.y - camera.y) * zoom + canvasHeight / 2;
    const targetScreenX = currentScreenX + bestTranslation.dx;
    const targetScreenY = currentScreenY + bestTranslation.dy;

    if (Math.abs(targetScreenX - currentScreenX) < 0.1 && Math.abs(targetScreenY - currentScreenY) < 0.1) {
      return;
    }

    if (automationExperiment) {
      automationExperiment.centerCameraOnAtScreenPoint(entity.com.x, entity.com.y, targetScreenX, targetScreenY);
      return;
    }

    this.renderer.centerCameraOnAtScreenPoint(entity.com.x, entity.com.y, targetScreenX, targetScreenY);
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    if (!this.dynamicSpeed) {
      this.manualSpeed = speed;
      this.speedSelect.value = speed.toString();
    }
    this.renderer.setSpeedMultiplier(speed);
    this.simulation.setSpeedMultiplier(speed);
  }

  private updateUIState(): void {
    const isAutomationRunning = automationController.isRunning();

    this.speedSelect.disabled = isAutomationRunning;
    this.dynamicSpeedButton.disabled = isAutomationRunning;
    this.playPause.disabled = isAutomationRunning;
    this.playPause.textContent = this.running ? 'Pause' : 'Play';
    const simulationTimeScale = document.getElementById('simulationTimeScale') as HTMLSelectElement;
    if (simulationTimeScale) {
      simulationTimeScale.disabled = isAutomationRunning;
    }
    const environmentCellSize = document.getElementById('environmentCellSize') as HTMLSelectElement;
    if (environmentCellSize) {
      environmentCellSize.disabled = isAutomationRunning;
    }
    const worldSize = document.getElementById('worldSize') as HTMLSelectElement;
    if (worldSize) {
      worldSize.disabled = isAutomationRunning;
    }
    const cullingStrategy = document.getElementById('cullingStrategy') as HTMLSelectElement;
    if (cullingStrategy) {
      cullingStrategy.disabled = isAutomationRunning;
    }
    const nutrientFieldType = document.getElementById('nutrientFieldType') as HTMLSelectElement;
    if (nutrientFieldType) {
      nutrientFieldType.disabled = isAutomationRunning;
    }
    const familyNonAggression = document.getElementById('familyNonAggression') as HTMLInputElement;
    if (familyNonAggression) {
      familyNonAggression.disabled = isAutomationRunning;
    }
    const resetSettingsPane = document.getElementById('resetSettingsPane') as HTMLButtonElement;
    if (resetSettingsPane) {
      resetSettingsPane.disabled = isAutomationRunning;
    }

    const sliderPanel = document.getElementById('sliderPanel');
    if (isAutomationRunning && sliderPanel instanceof HTMLElement && !sliderPanel.classList.contains('panel-collapsed')) {
      sliderPanel.classList.add('panel-collapsed');
      this.resize('left');
    }

    this.setAutomationControlLock(isAutomationRunning);
    this.syncRendererVisibilityFlags();
    this.syncSelectedEntityOnActiveRenderer();
    this.syncPanelToggleButtonStates();
    this.syncSeedInputsFromActiveContext();
  }

  private syncPanelToggleButtonState(toggleButtonId: string, panelId: string): void {
    const button = document.getElementById(toggleButtonId);
    const panel = document.getElementById(panelId);
    if (!(button instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) {
      return;
    }
    button.classList.toggle('panel-toggle-open', !panel.classList.contains('panel-collapsed'));
  }

  private syncPanelToggleButtonStates(): void {
    this.syncPanelToggleButtonState('toggleInfoPane', 'helpPanel');
    this.syncPanelToggleButtonState('toggleSliderPanel', 'sliderPanel');
  }

  private togglePanels(): void {
    this.statusPanelVisible = !this.statusPanelVisible;
    const controlPanel = document.getElementById('controlPanel');
    const toggleButton = document.getElementById('togglePanels');
    const sliderPanel = document.getElementById('sliderPanel');
    const helpPanel = document.getElementById('helpPanel');
    const automationPanel = document.getElementById('automationPanel');
    
    if (!(controlPanel instanceof HTMLElement) || !(toggleButton instanceof HTMLButtonElement)) {
      return;
    }
    
    if (this.statusPanelVisible) {
      controlPanel.classList.remove('status-panel-hidden');
      toggleButton.classList.add('status-panel-open');
      toggleButton.innerHTML = closeIcon;
      toggleButton.setAttribute('aria-pressed', 'true');
      if (this.sliderPanelWasOpen && sliderPanel instanceof HTMLElement) {
        sliderPanel.classList.remove('panel-collapsed');
      }
      if (this.helpPanelWasOpen && helpPanel instanceof HTMLElement) {
        helpPanel.classList.remove('panel-collapsed');
      }
      if (this.automationPanelWasOpen && automationPanel instanceof HTMLElement) {
        automationPanel.classList.remove('panel-collapsed');
      }
      this.resize('left');
      this.scrollPanelDockToEnd();
      requestAnimationFrame(() => requestAnimationFrame(() => this.updateToggleBtnPosition()));
    } else {
      controlPanel.classList.add('status-panel-hidden');
      toggleButton.classList.remove('status-panel-open');
      toggleButton.innerHTML = hamburgerIcon;
      toggleButton.setAttribute('aria-pressed', 'false');
      if (sliderPanel instanceof HTMLElement) {
        this.sliderPanelWasOpen = !sliderPanel.classList.contains('panel-collapsed');
        sliderPanel.classList.add('panel-collapsed');
      }
      if (helpPanel instanceof HTMLElement) {
        this.helpPanelWasOpen = !helpPanel.classList.contains('panel-collapsed');
        helpPanel.classList.add('panel-collapsed');
      }
      if (automationPanel instanceof HTMLElement) {
        this.automationPanelWasOpen = !automationPanel.classList.contains('panel-collapsed');
        automationPanel.classList.add('panel-collapsed');
      }
      this.resize('left');
      this.scrollPanelDockToEnd();
      requestAnimationFrame(() => requestAnimationFrame(() => this.updateToggleBtnPosition()));
    }
  }

  private setAutomationControlLock(isLocked: boolean): void {
    for (const container of this.automationLockedContainers) {
      container.classList.toggle('automation-locked', isLocked);
      const controls = container.querySelectorAll('button, input, select, textarea');
      for (const control of controls) {
        if (
          control instanceof HTMLButtonElement
          || control instanceof HTMLInputElement
          || control instanceof HTMLSelectElement
          || control instanceof HTMLTextAreaElement
        ) {
          control.disabled = isLocked;
        }
      }
    }
  }

  private updateDynamicSpeedState(): void {
    this.dynamicSpeedButton.classList.toggle('turbo-active', this.dynamicSpeed);
    this.dynamicSpeedButton.setAttribute('aria-pressed', this.dynamicSpeed ? 'true' : 'false');
    this.dynamicSpeedButton.textContent = this.dynamicSpeed ? 'Disable turbo' : 'Enable turbo';

    if (this.dynamicSpeed) {
      this.speedSelect.classList.add('disabled');
      this.dynamicSpeedValue = this.speed;
    } else {
      this.speedSelect.classList.remove('disabled');
      this.speed = parseFloat(this.speedSelect.value);
      this.dynamicSpeedValue = this.speed;
      this.setSpeed(this.speed);
    }
  }

  private setupUI(): void {
    const playPause = document.getElementById('playPause')!;
    const spawnControls = document.querySelector('.spawn-controls');
    const spawnConfigGrid = document.getElementById('spawnConfigGrid');
    const spawnInitialSeedInput = document.getElementById('spawnInitialSeed');
    const spawnEvolutionSeedInput = document.getElementById('spawnEvolutionSeed');
    const debugButtonRow = document.getElementById('debugButtonRow');
    const copyPositioningDebugBtn = document.getElementById('copyPositioningDebug');
    const copyRngBenchmarkDebugBtn = document.getElementById('copyRngBenchmarkDebug');
    const copyPreviewCanvasesDebugBtn = document.getElementById('copyPreviewCanvasesDebug');
    const copyPacingDebugBtn = document.getElementById('copyPacingDebug');
    const configSliders = document.getElementById('configSliders');
    const resetSettingsPaneBtn = document.getElementById('resetSettingsPane');

    if (!(spawnControls instanceof HTMLElement)) {
      throw new Error('Missing spawn controls');
    }

    if (!(playPause instanceof HTMLButtonElement)) {
      throw new Error('Missing play/pause button');
    }

    if (!(spawnConfigGrid instanceof HTMLElement)) {
      throw new Error('Missing spawn config grid');
    }

    if (!(spawnInitialSeedInput instanceof HTMLInputElement)) {
      throw new Error('Missing initial seed input');
    }

    if (!(spawnEvolutionSeedInput instanceof HTMLInputElement)) {
      throw new Error('Missing evolution seed input');
    }

    this.spawnInitialSeedInput = spawnInitialSeedInput;
    this.spawnEvolutionSeedInput = spawnEvolutionSeedInput;

    if (!(debugButtonRow instanceof HTMLElement)) {
      throw new Error('Missing debug button row');
    }

    if (!(copyPositioningDebugBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing copy positioning debug button');
    }

    if (!(copyRngBenchmarkDebugBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing copy benchmark debug button');
    }

    if (!(copyPreviewCanvasesDebugBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing copy preview canvases debug button');
    }

    if (!(copyPacingDebugBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing copy pacing debug button');
    }

    if (!(configSliders instanceof HTMLElement)) {
      throw new Error('Missing config slider container');
    }

    if (!(resetSettingsPaneBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing reset-settings button');
    }

    const copyTextToClipboard = async (text: string): Promise<boolean> => {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // fall back to execCommand copy
        }
      }

      const copyArea = document.createElement('textarea');
      copyArea.value = text;
      copyArea.setAttribute('readonly', '');
      copyArea.style.position = 'fixed';
      copyArea.style.opacity = '0';
      copyArea.style.pointerEvents = 'none';
      document.body.appendChild(copyArea);
      copyArea.select();
      copyArea.setSelectionRange(0, copyArea.value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(copyArea);
      return copied;
    };

    const debugParams = new URLSearchParams(window.location.search);
    const debugButtonsFlag = (debugParams.get('debugButtons') ?? '').toLowerCase();
    const showDebugButtons = debugButtonsFlag === '1' || debugButtonsFlag === 'true';
    this.collectPacingDebug = debugButtonsFlag === '1';
    const benchmarkIterationsRaw = Number.parseInt(debugParams.get('debugBenchmarkIterations') ?? '', 10);
    const benchmarkIterations = Number.isFinite(benchmarkIterationsRaw)
      ? Math.max(100000, benchmarkIterationsRaw)
      : 2000000;

    if (showDebugButtons) {
      debugButtonRow.classList.remove('hidden');
      copyPositioningDebugBtn.addEventListener('click', async () => {
        const defaultButtonText = 'Copy positioning to clipboard';
        const runningButtonText = 'Copying...';
        copyPositioningDebugBtn.disabled = true;
        copyPositioningDebugBtn.textContent = runningButtonText;

        const snapshot = this.buildCameraDebugSnapshot();
        const copied = await copyTextToClipboard(snapshot);
        copyPositioningDebugBtn.disabled = false;
        copyPositioningDebugBtn.textContent = defaultButtonText;
        EventLog.log('system', copied ? 'Copied positioning debug to clipboard' : 'Failed to copy positioning debug');
      });

      copyRngBenchmarkDebugBtn.addEventListener('click', async () => {
        const defaultButtonText = 'Copy RNG benchmark to clipboard';
        const runningButtonText = 'Benchmarking...';
        copyRngBenchmarkDebugBtn.disabled = true;
        copyRngBenchmarkDebugBtn.textContent = runningButtonText;

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        const snapshot = this.buildRandomBenchmarkSnapshot(benchmarkIterations);
        const copied = await copyTextToClipboard(snapshot);
        copyRngBenchmarkDebugBtn.disabled = false;
        copyRngBenchmarkDebugBtn.textContent = defaultButtonText;
        EventLog.log('system', copied ? 'Copied RNG benchmark to clipboard' : 'Failed to copy RNG benchmark');
      });

      copyPreviewCanvasesDebugBtn.addEventListener('click', async () => {
        const defaultButtonText = 'Copy preview metadata to clipboard';
        const runningButtonText = 'Capturing...';
        copyPreviewCanvasesDebugBtn.disabled = true;
        copyPreviewCanvasesDebugBtn.textContent = runningButtonText;

        const snapshot = this.buildPreviewCanvasesSnapshot();
        const copied = await copyTextToClipboard(snapshot);
        copyPreviewCanvasesDebugBtn.disabled = false;
        copyPreviewCanvasesDebugBtn.textContent = defaultButtonText;
        EventLog.log('system', copied ? 'Copied preview metadata to clipboard' : 'Failed to copy preview metadata');
      });

      copyPacingDebugBtn.addEventListener('click', async () => {
        const defaultButtonText = 'Copy pacing debug to clipboard';
        const runningButtonText = 'Copying...';
        copyPacingDebugBtn.disabled = true;
        copyPacingDebugBtn.textContent = runningButtonText;

        const snapshot = this.buildPacingDebugSnapshot();
        const copied = await copyTextToClipboard(snapshot);
        copyPacingDebugBtn.disabled = false;
        copyPacingDebugBtn.textContent = defaultButtonText;
        EventLog.log('system', copied ? 'Copied pacing debug to clipboard' : 'Failed to copy pacing debug');
      });
    }

    let appliedSettingsPresetId = SETTINGS_PRESETS[0]?.id ?? '';
    let appliedSettingsPresetConfig: Config = { ...DEFAULT_CONFIG };
    let appliedSettingsPresetSource: 'default' | 'manual' | 'url' = 'default';

    renderSpawnGrid(spawnConfigGrid, SPAWN_CONFIGS);
    updateSpawnGridDisabledState();

    const segmentTypeToggles = document.getElementById('segmentTypeToggles');
    if (segmentTypeToggles) {
      const parseHexColor = (value: string): [number, number, number] | null => {
        const hex = value.startsWith('#') ? value.slice(1) : value;
        if (hex.length !== 6) return null;
        const parsed = Number.parseInt(hex, 16);
        if (!Number.isFinite(parsed)) return null;
        return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
      };

      const brightenColor = (value: string, amount: number): string => {
        const channels = parseHexColor(value);
        if (!channels) return value;
        const [r, g, b] = channels;
        const brighten = (channel: number): number => Math.round(channel + (255 - channel) * amount);
        return `rgb(${brighten(r)}, ${brighten(g)}, ${brighten(b)})`;
      };

      const colorWithAlpha = (value: string, alpha: number): string => {
        const channels = parseHexColor(value);
        if (!channels) return value;
        const [r, g, b] = channels;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      const typeNameMap: Record<SegmentType, string> = {
        [SegmentType.Armor]: 'Arm',
        [SegmentType.Photosynth]: 'Pho',
        [SegmentType.Locomotor]: 'Loc',
        [SegmentType.Attack]: 'Att',
        [SegmentType.Neural]: 'Neu',
      };

      const typeOrderMap: Record<SegmentType, number> = {
        [SegmentType.Armor]: 0,
        [SegmentType.Attack]: 1,
        [SegmentType.Locomotor]: 2,
        [SegmentType.Neural]: 3,
        [SegmentType.Photosynth]: 4,
      };

      const orderedSegmentTypes = [...SEGMENT_TYPES].sort((a, b) => {
        return (typeOrderMap[a] ?? 99) - (typeOrderMap[b] ?? 99);
      });

      for (const type of orderedSegmentTypes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spawn-toggle-btn spawn-toggle-active';
        btn.textContent = typeNameMap[type];
        btn.dataset.segmentType = type;
        btn.style.setProperty('--segment-border-color', brightenColor(SEGMENT_COLORS[type], 0.32));
        btn.style.setProperty('--segment-background-color', colorWithAlpha(SEGMENT_COLORS[type], 0.22));
        btn.style.setProperty('--segment-background-hover-color', colorWithAlpha(SEGMENT_COLORS[type], 0.32));
        
        btn.addEventListener('click', () => {
          segmentTypeState.toggle(type);
        });
        
        segmentTypeToggles.appendChild(btn);
      }
    }

    segmentTypeState.addListener(() => {
      updateSpawnGridDisabledState();
      this.simulation.setEnabledSegmentTypes(segmentTypeState.getEnabledTypes());
      
      document.querySelectorAll('.spawn-toggle-btn').forEach((btn) => {
        const type = btn.getAttribute('data-segment-type') as SegmentType;
        if (type) {
          const isEnabled = segmentTypeState.isEnabled(type);
          btn.classList.toggle('spawn-toggle-active', isEnabled);
          btn.classList.toggle('spawn-toggle-disabled', !isEnabled);
        }
      });
    });

    // Filter input to only allow alphanumeric characters (A-Za-z0-9)
    const filterAlphanumeric = (input: string): string => {
      return input.replace(/[^A-Za-z0-9]/g, '');
    };

    // Hash alphanumeric string to a 32-bit integer using DJB2 hash
    const hashStringToSeed = (str: string): number => {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + char; // hash * 33 + c
      }
      return hash >>> 0; // Convert to unsigned 32-bit integer
    };

    const parseRandomSeedInputValue = (raw: string): number | null | undefined => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return null;
      }
      // Filter to only alphanumeric characters
      const filtered = filterAlphanumeric(trimmed);
      if (filtered.length === 0) {
        return undefined;
      }
      // Convert alphanumeric string to numeric seed
      return hashStringToSeed(filtered);
    };

    const applySeedInput = (
      rawValue: string,
      apply: (seed: number | null) => void,
      seedName: string,
      options: { logResult?: boolean; revertOnInvalid?: boolean } = {},
    ): void => {
      const { logResult = true, revertOnInvalid = true } = options;
      const parsedSeed = parseRandomSeedInputValue(rawValue);
      if (parsedSeed === undefined) {
        if (logResult) {
          EventLog.log('system', `${seedName} must be an integer`);
        }
        if (revertOnInvalid) {
          this.syncSeedInputsFromActiveContext();
        }
        return;
      }

      // Store the original text for display purposes
      const trimmed = rawValue.trim();
      if (parsedSeed !== null && parsedSeed !== undefined) {
        const filtered = filterAlphanumeric(trimmed);
        if (seedName === 'Initial seed') {
          this.spawnInitialSeedText = filtered;
        } else if (seedName === 'Evolution seed') {
          this.spawnEvolutionSeedText = filtered;
        }
      } else {
        if (seedName === 'Initial seed') {
          this.spawnInitialSeedText = '';
        } else if (seedName === 'Evolution seed') {
          this.spawnEvolutionSeedText = '';
        }
      }

      apply(parsedSeed);
      this.syncSeedInputsFromActiveContext();
      if (logResult) {
        EventLog.log('system', parsedSeed === null ? `${seedName} cleared` : `${seedName} set to ${Math.trunc(parsedSeed) >>> 0}`);
      }
    };

    this.syncSeedInputsFromActiveContext();
    
    // Filter input in real-time to only allow alphanumeric characters
    const filterSeedInput = (input: HTMLInputElement): void => {
      const filtered = filterAlphanumeric(input.value);
      if (filtered !== input.value) {
        input.value = filtered;
      }
    };
    
    spawnInitialSeedInput.addEventListener('input', () => {
      filterSeedInput(spawnInitialSeedInput);
      applySeedInput(spawnInitialSeedInput.value, seed => this.simulation.setInitialRandomSeed(seed), 'Initial seed', {
        logResult: false,
        revertOnInvalid: false,
      });
    });
    spawnInitialSeedInput.addEventListener('change', () => {
      applySeedInput(spawnInitialSeedInput.value, seed => this.simulation.setInitialRandomSeed(seed), 'Initial seed');
    });
    spawnEvolutionSeedInput.addEventListener('input', () => {
      filterSeedInput(spawnEvolutionSeedInput);
      applySeedInput(spawnEvolutionSeedInput.value, seed => this.simulation.setEvolutionRandomSeed(seed), 'Evolution seed', {
        logResult: false,
        revertOnInvalid: false,
      });
    });
    spawnEvolutionSeedInput.addEventListener('change', () => {
      applySeedInput(spawnEvolutionSeedInput.value, seed => this.simulation.setEvolutionRandomSeed(seed), 'Evolution seed');
    });

    const spawnSeedClearButtons = document.querySelectorAll<HTMLButtonElement>('.spawn-seed-clear');
    const updateSeedClearVisibility = (input: HTMLInputElement, clearBtn: HTMLButtonElement): void => {
      clearBtn.classList.toggle('hidden', !input.value);
    };
    spawnSeedClearButtons.forEach((btn) => {
      const input = btn.previousElementSibling as HTMLInputElement;
      updateSeedClearVisibility(input, btn);
      input.addEventListener('input', () => updateSeedClearVisibility(input, btn));
      btn.addEventListener('click', () => {
        input.value = '';
        updateSeedClearVisibility(input, btn);
        if (input === spawnInitialSeedInput) {
          applySeedInput('', seed => this.simulation.setInitialRandomSeed(seed), 'Initial seed');
        } else if (input === spawnEvolutionSeedInput) {
          applySeedInput('', seed => this.simulation.setEvolutionRandomSeed(seed), 'Evolution seed');
        }
      });
    });

    renderConfigSliders(configSliders, this.simulation.config, {
      getResetConfig: () => appliedSettingsPresetConfig,
    });

    for (const slider of CONFIG_SLIDERS) {
      const initialValue = readSliderValue(slider, this.simulation.config);
      bindSlider(
        getSliderInputId(slider.key),
        getSliderValueId(slider.key),
        initialValue,
        (value) => applySliderValue(slider, this.simulation.config, value),
        (value) => formatSliderValue(slider, value)
      );
    }

    this.updateUIState();

    playPause.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.running = !this.running;
      playPause.textContent = this.running ? 'Pause' : 'Play';
      if (this.running) {
        this.calcTimePerFrameHistory = [];
        this.smoothedCalcTimeMs = 0;
      }
    });

    this.speedSelect.addEventListener('change', () => {
      this.setSpeed(parseFloat(this.speedSelect.value));
      if (this.dynamicSpeed) {
        this.dynamicSpeed = false;
        this.updateDynamicSpeedState();
      }
    });

    const spawnFromConfig = (configIndex: number, count: number): void => {
      const config = SPAWN_CONFIGS[configIndex];
      if (!config) {
        return;
      }

      this.simulation.spawnBiased(config, count);
    };

    spawnControls.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const spawnButton = target.closest<HTMLButtonElement>('button[data-spawn-count]');
      if (!spawnButton || !spawnControls.contains(spawnButton)) {
        return;
      }

      const count = Number.parseInt(spawnButton.dataset.spawnCount ?? '', 10);
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }

      const configIndex = Number.parseInt(spawnButton.dataset.spawnConfigIndex ?? '', 10);
      if (!Number.isInteger(configIndex) || configIndex < 0) {
        return;
      }

      spawnFromConfig(configIndex, count);
    });

    const clearAllBtn = document.getElementById('clearAll')!;

    clearAllBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.simulation.resetMainSimulation();
      this.selectedEntity = null;
      this.syncSelectedEntityOnActiveRenderer();
      this.stopTrackingSelectedEntity();
      document.getElementById('selectedEntity')!.classList.add('hidden');
      EventLog.log('system', 'All entities cleared');
    });

    for (const definition of CONFIG_SELECT_CONTROLS) {
      bindSelectControl(definition, {
        config: this.simulation.config,
        resizeWorld: (newSize) => this.simulation.resizeWorld(newSize),
        setEnvironmentCellSize: (cellSize) => this.simulation.setEnvironmentCellSize(cellSize),
        setNutrientFieldType: (type) => this.simulation.setNutrientFieldType(type),
        centerCamera: () => this.centerCamera(),
      });
    }

    const showEnvironmentFootprintDebug = document.getElementById('showEnvironmentFootprintDebug') as HTMLInputElement;
    if (showEnvironmentFootprintDebug) {
      showEnvironmentFootprintDebug.addEventListener('change', () => {
        this.syncRendererVisibilityFlags();
      });
    }

    const showNeuralAndLocomotorActivity = document.getElementById('showNeuralAndLocomotorActivity') as HTMLInputElement;
    if (showNeuralAndLocomotorActivity) {
      showNeuralAndLocomotorActivity.addEventListener('change', () => {
        this.syncRendererVisibilityFlags();
      });
    }

    const disableFlashEffects = document.getElementById('disableFlashEffects') as HTMLInputElement;
    if (disableFlashEffects) {
      disableFlashEffects.addEventListener('change', () => {
        this.syncRendererVisibilityFlags();
      });
    }

    const environmentOverlayToggle = document.getElementById('environmentOverlayToggle');
    if (environmentOverlayToggle instanceof HTMLElement) {
      const overlayButtons = Array.from(environmentOverlayToggle.querySelectorAll<HTMLButtonElement>('button[data-overlay-channel]'));
      let selectedOverlayChannel: EnvironmentChannelId | 'none' = 'none';
      const isEnvironmentChannelId = (value: string): value is EnvironmentChannelId => {
        return ENVIRONMENT_CHANNELS.includes(value as EnvironmentChannelId);
      };

      const applyOverlayState = (): void => {
        this.renderer.setEnvironmentOverlayChannel(selectedOverlayChannel);
        automationController.setEnvironmentOverlayChannel(selectedOverlayChannel);
        for (const button of overlayButtons) {
          const channel = button.dataset.overlayChannel;
          const isActive = channel === selectedOverlayChannel;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          const channelName = channel ?? '';
          button.textContent = `${isActive ? 'Hide' : 'Show'} ${channelName} overlay`;
        }
      };

      environmentOverlayToggle.addEventListener('mousedown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || event.button !== 0) {
          return;
        }

        const button = target.closest<HTMLButtonElement>('button[data-overlay-channel]');
        if (!button || !environmentOverlayToggle.contains(button)) {
          return;
        }

        event.preventDefault();
        const channel = button.dataset.overlayChannel;
        if (!channel || !isEnvironmentChannelId(channel)) {
          return;
        }

        selectedOverlayChannel = selectedOverlayChannel === channel ? 'none' : channel;
        applyOverlayState();
      });

      applyOverlayState();
    }

    const showHealthbars = document.getElementById('showHealthbars') as HTMLInputElement;
    showHealthbars.addEventListener('change', () => {
      this.syncRendererVisibilityFlags();
    });

    const showGrid = document.getElementById('showGrid') as HTMLInputElement;
    showGrid.addEventListener('change', () => {
      this.syncRendererVisibilityFlags();
    });

    this.syncRendererVisibilityFlags();

    this.dynamicSpeedButton.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.dynamicSpeed = !this.dynamicSpeed;
      this.updateDynamicSpeedState();
    });

    const togglePanelsBtn = document.getElementById('togglePanels') as HTMLButtonElement;
    if (togglePanelsBtn) {
      togglePanelsBtn.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.togglePanels();
      });
    }

    this.setupVisualViewportTracking();

    const familyNonAggression = document.getElementById('familyNonAggression') as HTMLInputElement;
    this.simulation.config.familyNonAggression = familyNonAggression.checked;
    familyNonAggression.addEventListener('change', () => {
      this.simulation.config.familyNonAggression = familyNonAggression.checked;
    });

    resetSettingsPaneBtn.addEventListener('click', () => {
      const checkboxIds = ['showHealthbars', 'showGrid', 'showEnvironmentFootprintDebug', 'disableFlashEffects'];
      for (const checkboxId of checkboxIds) {
        const checkbox = document.getElementById(checkboxId);
        if (!(checkbox instanceof HTMLInputElement)) {
          continue;
        }
        checkbox.checked = checkbox.defaultChecked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const familyNonAggressionCheckbox = document.getElementById('familyNonAggression');
      if (familyNonAggressionCheckbox instanceof HTMLInputElement) {
        familyNonAggressionCheckbox.checked = appliedSettingsPresetConfig.familyNonAggression;
        familyNonAggressionCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const selectIds = ['worldSize', 'environmentCellSize', 'cullingStrategy'];
      for (const selectId of selectIds) {
        const select = document.getElementById(selectId);
        const definition = CONFIG_SELECT_CONTROLS.find(control => control.id === selectId);
        if (!(select instanceof HTMLSelectElement) || !definition) {
          continue;
        }

        select.value = definition.readValue(appliedSettingsPresetConfig);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      EventLog.log('system', 'Settings pane reset to applied preset baseline');
      updatePresetPreview();
    });

    const toggleInfoPane = document.getElementById('toggleInfoPane')!;
    const helpPanel = document.getElementById('helpPanel')!;
    const closeHelpPanel = document.getElementById('closeHelpPanel');
    const bindPanelTogglePress = (button: HTMLButtonElement, onActivate: () => void): void => {
      button.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        onActivate();
      });

      button.addEventListener('click', (event) => {
        if (event.detail !== 0) {
          return;
        }
        event.preventDefault();
        onActivate();
      });
    };

    bindPanelTogglePress(toggleInfoPane as HTMLButtonElement, () => {
      helpPanel.classList.toggle('panel-collapsed');
      this.syncPanelToggleButtonStates();
      this.resize('left');
      this.scrollPanelDockToEnd();
    });

    if (closeHelpPanel instanceof HTMLButtonElement) {
      closeHelpPanel.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        helpPanel.classList.add('panel-collapsed');
        this.syncPanelToggleButtonStates();
        this.resize('left');
        this.scrollPanelDockToEnd();
      });
    }

    const sliderPanel = document.getElementById('sliderPanel')!;
    const toggleSliderPanel = document.getElementById('toggleSliderPanel')!;
    const closeSliderPanel = document.getElementById('closeSliderPanel')!;
    const resetAllSlidersBtn = document.getElementById('resetAllSliders');
    const settingsPresetSelect = document.getElementById('settingsPresetSelect');
    const settingsPresetPreview = document.getElementById('settingsPresetPreview');
    const settingsPresetDiff = document.getElementById('settingsPresetDiff');
    const applySettingsPresetBtn = document.getElementById('applySettingsPreset');
    const settingsPresetApplied = document.getElementById('settingsPresetApplied');

    if (!(resetAllSlidersBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing reset-all-sliders button');
    }

    if (!(settingsPresetSelect instanceof HTMLSelectElement)) {
      throw new Error('Missing settings preset select');
    }

    if (!(settingsPresetPreview instanceof HTMLTextAreaElement)) {
      throw new Error('Missing settings preset preview');
    }

    if (!(settingsPresetDiff instanceof HTMLTextAreaElement)) {
      throw new Error('Missing settings preset diff');
    }

    if (!(applySettingsPresetBtn instanceof HTMLButtonElement)) {
      throw new Error('Missing apply settings preset button');
    }

    if (!(settingsPresetApplied instanceof HTMLElement)) {
      throw new Error('Missing applied settings preset label');
    }

    const formatSettingValue = (value: unknown): string => {
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          return value.toString();
        }
        return value.toFixed(6).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      return String(value);
    };

    const toPresetSlug = (value: string): string => {
      return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    };

    const quantizeToSliderStep = (value: number, min: number, max: number, step: number): number => {
      const clamped = Math.min(max, Math.max(min, value));
      if (step <= 0) {
        return clamped;
      }
      const snapped = min + Math.round((clamped - min) / step) * step;
      const bounded = Math.min(max, Math.max(min, snapped));
      return Number(bounded.toFixed(12));
    };

    const normalizeConfigForUi = (config: Config): Config => {
      const quantized: Config = { ...config };

      for (const slider of CONFIG_SLIDERS) {
        const sliderValue = readSliderValue(slider, quantized);
        const snapped = quantizeToSliderStep(sliderValue, slider.min, slider.max, slider.step);
        applySliderValue(slider, quantized, snapped);
      }

      return quantized;
    };

    const resolvePresetConfigForUi = (presetId: string): Config => {
      const preset = SETTINGS_PRESETS.find(candidate => candidate.id === presetId) ?? SETTINGS_PRESETS[0];
      const resolved = resolveSettingsPresetConfig(preset);
      return normalizeConfigForUi(resolved);
    };

    const resolvePresetById = (presetId: string): SettingsPreset | undefined => {
      return SETTINGS_PRESETS.find(candidate => candidate.id === presetId) ?? SETTINGS_PRESETS[0];
    };

    const updateAppliedPresetLabel = (): void => {
      const appliedPreset = resolvePresetById(appliedSettingsPresetId);
      if (!appliedPreset) {
        settingsPresetApplied.textContent = 'Applied preset: (none)';
        return;
      }

      const label = document.createElement('span');
      label.className = 'settings-preset-applied-label';
      label.textContent = 'Applied preset: ';

      const name = document.createElement('span');
      name.className = 'settings-preset-applied-name';
      name.textContent = appliedPreset.name;

      settingsPresetApplied.replaceChildren(label, name);

      if (appliedSettingsPresetSource === 'url') {
        const source = document.createElement('span');
        source.className = 'settings-preset-applied-source';
        source.textContent = ' (from URL)';
        settingsPresetApplied.append(source);
      }
    };

    const setAppliedPresetBaseline = (
      presetId: string,
      source: 'default' | 'manual' | 'url' = 'manual'
    ): void => {
      const preset = resolvePresetById(presetId);
      if (!preset) {
        return;
      }
      appliedSettingsPresetId = preset.id;
      appliedSettingsPresetConfig = resolvePresetConfigForUi(preset.id);
      appliedSettingsPresetSource = source;
      updateAppliedPresetLabel();
    };

    const EXCLUDED_FROM_PRESET_DIFF = new Set([
      'initialRandomSeed',
      'evolutionRandomSeed',
    ]);

    const updatePresetPreview = (): void => {
      const preset = SETTINGS_PRESETS.find(candidate => candidate.id === settingsPresetSelect.value) ?? SETTINGS_PRESETS[0];
      const resolvedPresetConfig = resolvePresetConfigForUi(preset.id);
      const currentConfigNormalized = normalizeConfigForUi(this.simulation.config);
      const lines = [
        preset.name,
        preset.description,
        '',
      ];
      const entries = Object.entries(resolvedPresetConfig)
        .filter(([key]) => !EXCLUDED_FROM_PRESET_DIFF.has(key))
        .sort(([a], [b]) => a.localeCompare(b));
      const diffLines: string[] = ['Current settings -> selected preset:', ''];
      for (const [key, value] of entries) {
        lines.push(`${key} = ${formatSettingValue(value)}`);

        const currentValue = (currentConfigNormalized as unknown as Record<string, unknown>)[key];
        const isDifferent = typeof value === 'number' && typeof currentValue === 'number'
          ? Math.abs(value - currentValue) > 1e-12
          : value !== currentValue;

        if (isDifferent) {
          diffLines.push(`${key}: ${formatSettingValue(currentValue)} -> ${formatSettingValue(value)}`);
        }
      }
      settingsPresetPreview.value = lines.join('\n');
      settingsPresetDiff.value = diffLines.length > 2
        ? diffLines.join('\n')
        : 'Current settings -> selected preset:\n\nNo differences.';
    };

    const applyPresetToUi = (source: 'manual' | 'url' = 'manual'): void => {
      const selectedPreset = resolvePresetById(settingsPresetSelect.value);
      if (!selectedPreset) {
        return;
      }
      const resolvedConfig: Config = resolvePresetConfigForUi(selectedPreset.id);

      this.simulation.config.familyNonAggression = resolvedConfig.familyNonAggression;

      for (const definition of CONFIG_SELECT_CONTROLS) {
        const select = document.getElementById(definition.id);
        if (!(select instanceof HTMLSelectElement)) {
          continue;
        }
        const value = definition.readValue(resolvedConfig);
        if (!Array.from(select.options).some(option => option.value === value)) {
          continue;
        }
        select.value = value;
        select.dispatchEvent(new Event('change'));
      }

      for (const slider of CONFIG_SLIDERS) {
        const defaultValue = readSliderValue(slider, resolvedConfig);
        const input = document.getElementById(getSliderInputId(slider.key));

        if (input instanceof HTMLInputElement) {
          input.value = defaultValue.toString();
          input.dispatchEvent(new Event('input'));
          continue;
        }

        applySliderValue(slider, this.simulation.config, defaultValue);
        const valueEl = document.getElementById(getSliderValueId(slider.key));
        if (valueEl) {
          valueEl.textContent = formatSliderValue(slider, defaultValue);
        }
      }

      const familyNonAggression = document.getElementById('familyNonAggression');
      if (familyNonAggression instanceof HTMLInputElement) {
        familyNonAggression.checked = resolvedConfig.familyNonAggression;
        familyNonAggression.dispatchEvent(new Event('change'));
      }

      setAppliedPresetBaseline(selectedPreset.id, source);

      EventLog.log('system', `Applied settings preset: ${selectedPreset.name}`);
      updatePresetPreview();
    };

    const presetOptions = document.createDocumentFragment();
    for (const preset of SETTINGS_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      presetOptions.appendChild(option);
    }
    settingsPresetSelect.replaceChildren(presetOptions);
    settingsPresetSelect.value = SETTINGS_PRESETS[0]?.id ?? '';
    setAppliedPresetBaseline(settingsPresetSelect.value, 'default');
    updatePresetPreview();

    const presetParams = new URLSearchParams(window.location.search);
    const presetParam = presetParams.get('settingsPreset') ?? presetParams.get('presetSettings');
    if (presetParam) {
      const selectedPreset = SETTINGS_PRESETS.find(preset => {
        return preset.id === presetParam
          || toPresetSlug(preset.id) === toPresetSlug(presetParam)
          || toPresetSlug(preset.name) === toPresetSlug(presetParam);
      });
      if (selectedPreset) {
        settingsPresetSelect.value = selectedPreset.id;
        updatePresetPreview();
        applyPresetToUi('url');
      }
    }

    settingsPresetSelect.addEventListener('change', () => {
      updatePresetPreview();
    });

    for (const definition of CONFIG_SELECT_CONTROLS) {
      const select = document.getElementById(definition.id);
      if (!(select instanceof HTMLSelectElement)) {
        continue;
      }
      select.addEventListener('change', () => {
        updatePresetPreview();
      });
    }

    familyNonAggression.addEventListener('change', () => {
      updatePresetPreview();
    });

    sliderPanel.addEventListener('input', () => {
      updatePresetPreview();
    });

    sliderPanel.addEventListener('change', () => {
      updatePresetPreview();
    });

    applySettingsPresetBtn.addEventListener('click', () => {
      applyPresetToUi();
    });

    const resetAllSliders = (): void => {
      for (const slider of CONFIG_SLIDERS) {
        const defaultValue = readSliderValue(slider, appliedSettingsPresetConfig);
        const input = document.getElementById(getSliderInputId(slider.key));

        if (input instanceof HTMLInputElement) {
          input.value = defaultValue.toString();
          input.dispatchEvent(new Event('input'));
          continue;
        }

        applySliderValue(slider, this.simulation.config, defaultValue);
        const valueEl = document.getElementById(getSliderValueId(slider.key));
        if (valueEl) {
          valueEl.textContent = formatSliderValue(slider, defaultValue);
        }
      }

      EventLog.log('system', 'All sliders reset to applied preset baseline');
      updatePresetPreview();
    };

    this.automationLockedContainers = [spawnControls, sliderPanel];
    this.setAutomationControlLock(false);

    bindPanelTogglePress(toggleSliderPanel as HTMLButtonElement, () => {
      sliderPanel.classList.toggle('panel-collapsed');
      this.syncPanelToggleButtonStates();
      this.resize('left');
      this.scrollPanelDockToEnd();
    });

    closeSliderPanel.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      sliderPanel.classList.add('panel-collapsed');
      this.syncPanelToggleButtonStates();
      this.resize('left');
      this.scrollPanelDockToEnd();
    });

    resetAllSlidersBtn.addEventListener('click', () => {
      resetAllSliders();
    });

    this.syncPanelToggleButtonStates();

    this.setupCloseButton();
  }

  private setupCloseButton(): void {
    const closeBtn = document.getElementById('closeSelectedEntity')!;
    closeBtn.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.selectedEntity = null;
      this.displayedGenome = '';
      this.syncSelectedEntityOnActiveRenderer();
      this.stopTrackingSelectedEntity();
      document.getElementById('selectedEntity')!.classList.add('hidden');
    });
  }

  private setupAutomation(): void {
    setupAutomationPanel({
      canvas: this.canvas,
      speedSelect: this.speedSelect,
      playPauseBtn: this.playPause,
      setSpeed: (speed) => {
        this.setSpeed(speed);
      },
      resetSimulation: () => {
        this.simulation.resetMainSimulation();
      },
      updateUIState: () => {
        this.updateUIState();
      },
      getLastProgressUpdateMs: () => {
        return this.lastAutomationProgressUpdateMs;
      },
      setLastProgressUpdateMs: (timeMs) => {
        this.lastAutomationProgressUpdateMs = timeMs;
      },
      onLayoutChange: (anchor) => {
        this.resize(anchor);
      },
      scrollPanelDockToEnd: () => {
        this.scrollPanelDockToEnd();
      },
    });
  }

  private injectIcons(): void {
    const resetPlaceholder = document.querySelector('.reset-icon-placeholder');
    if (resetPlaceholder) {
      resetPlaceholder.innerHTML = resetIcon;
    }

    document.querySelectorAll('.icon-placeholder').forEach((el) => {
      (el as HTMLElement).innerHTML = closeIcon;
    });
  }

  private setupLegends(): void {
    applyLegendColors();

    document.querySelectorAll('[data-bar]').forEach((el) => {
      const type = el.getAttribute('data-bar') as keyof typeof BAR_COLORS;
      if (BAR_COLORS[type]) {
        (el as HTMLElement).style.background = BAR_COLORS[type];
      }
    });
  }

  private handleClick(e: MouseEvent): void {
    const automationExperiment = this.getActiveAutomationExperiment();
    const dragExceededDeadZone = automationExperiment
      ? automationExperiment.didDragExceedDeadZone()
      : this.renderer.didDragExceedDeadZone();
    if (dragExceededDeadZone) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = automationExperiment
      ? automationExperiment.screenToWorld(screenX, screenY)
      : this.renderer.screenToWorld(screenX, screenY);
    const entities = automationExperiment ? automationExperiment.getEntities() : this.simulation.entities;
    const worldSize = automationExperiment
      ? automationExperiment.getWorldSize()
      : { width: this.simulation.config.worldWidth, height: this.simulation.config.worldHeight };

    let closest: Entity | null = null;
    let closestDist: number = INPUT_CONSTANTS.clickSelectionDistance;
    const w = worldSize.width;
    const h = worldSize.height;

    for (const entity of entities) {
      const checkDist = (ex: number, ey: number): number => {
        const dx = ex - worldPos.x;
        const dy = ey - worldPos.y;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const dist = checkDist(entity.position.x, entity.position.y);
      const distWrapX = checkDist(entity.position.x + w, entity.position.y);
      const distWrapY = checkDist(entity.position.x - w, entity.position.y);
      const distWrapX2 = checkDist(entity.position.x, entity.position.y + h);
      const distWrapY2 = checkDist(entity.position.x, entity.position.y - h);
      const minDist = Math.min(dist, distWrapX, distWrapY, distWrapX2, distWrapY2);

      if (minDist < closestDist) {
        const isWithinBounds = Math.abs(entity.position.x - worldPos.x) <= w / 2 && Math.abs(entity.position.y - worldPos.y) <= h / 2;
        const isWithinBoundsX = Math.abs((entity.position.x + w) - worldPos.x) <= w / 2 || Math.abs((entity.position.x - w) - worldPos.x) <= w / 2;
        const isWithinBoundsY = Math.abs((entity.position.y + h) - worldPos.y) <= h / 2 || Math.abs((entity.position.y - h) - worldPos.y) <= h / 2;
        
        if (isWithinBounds || isWithinBoundsX || isWithinBoundsY) {
          closestDist = minDist;
          closest = entity;
        }
      }
    }

    if (closest && this.selectedEntity && closest.id === this.selectedEntity.id) {
      this.selectedEntity = null;
      this.syncSelectedEntityOnActiveRenderer();
      this.stopTrackingSelectedEntity();
      this.updateEntityInfo();
    } else {
      this.selectedEntity = closest;
      this.syncSelectedEntityOnActiveRenderer();
      if (closest) {
        this.startTrackingSelectedEntity(closest.id);
        this.lastRenderedRelativeIds.clear();
      } else {
        this.stopTrackingSelectedEntity();
      }
      this.updateEntityInfo();
      if (this.selectedEntity) {
        this.centerCameraOnEntity(this.selectedEntity);
      }
    }
  }

  private updateEntityInfo(): void {
    const container = document.getElementById('selectedEntity')!;
    const nameEl = document.getElementById('entityName')!;
    const stats = document.getElementById('entityStats')!;
    const income = document.getElementById('entityIncome')!;
    const genomeEl = document.getElementById('entityGenome') as HTMLTextAreaElement;
    const previewCanvas = document.getElementById('entityPreview') as HTMLCanvasElement;

    const automationExperiment = this.getActiveAutomationExperiment();

    if (!this.selectedEntity || this.selectedEntity.dead) {
      container.classList.add('hidden');
      this.selectedEntity = null;
      this.displayedGenome = '';
      genomeEl.value = '';
      this.lastPreviewedEntityId = null;
      this.syncSelectedEntityOnActiveRenderer();
      this.stopTrackingSelectedEntity();
      return;
    }

    const currentEntity = automationExperiment
      ? automationExperiment.getEntityById(this.selectedEntity.id)
      : this.simulation.entities.find((entity) => entity.id === this.selectedEntity!.id) ?? null;

    if (!currentEntity || currentEntity.dead) {
      container.classList.add('hidden');
      this.selectedEntity = null;
      this.displayedGenome = '';
      genomeEl.value = '';
      this.lastPreviewedEntityId = null;
      this.syncSelectedEntityOnActiveRenderer();
      this.stopTrackingSelectedEntity();
      return;
    }

    this.selectedEntity = currentEntity;
    this.syncSelectedEntityOnActiveRenderer();

    container.classList.remove('hidden');

    if (!currentEntity.name) {
      currentEntity.name = generateEntityName();
    }
    nameEl.textContent = currentEntity.name;

    if (currentEntity.id !== this.lastPreviewedEntityId) {
      this.lastPreviewedEntityId = currentEntity.id;
      this.renderer.renderEntityPreview(currentEntity, previewCanvas);
    }

    if (currentEntity.genome !== this.displayedGenome) {
      this.displayedGenome = currentEntity.genome;
      genomeEl.value = currentEntity.genome;
    }

    const config = automationExperiment ? automationExperiment.getConfig() : this.simulation.config;
    const segCount = currentEntity.segments.length;
    const basePhotosynthesisMultiplier = calculatePhotosynthesisMultiplier(currentEntity);
    const environmentField = automationExperiment ? automationExperiment.getEnvironmentField() : this.simulation.getEnvironmentField();
    const footprintRadius = Math.max(
      config.environmentCellSize * 0.75,
      currentEntity.boundingRadius * config.environmentFootprintScale
    );
    const nutrientAtCom = environmentField.sample(
      'nutrient',
      currentEntity.com.x,
      currentEntity.com.y,
    );
    const nutrientLevel = environmentField.sampleFootprint(
      'nutrient',
      currentEntity.com.x,
      currentEntity.com.y,
      footprintRadius,
      config.environmentFootprintFalloffPower,
    );
    const environmentPhotosynthesisMultiplier = calculateEnvironmentPhotosynthesisMultiplier(nutrientLevel, config);
    const photosynthesisMultiplier = basePhotosynthesisMultiplier * environmentPhotosynthesisMultiplier;
    const currentSpeed = Math.hypot(currentEntity.velocity.x, currentEntity.velocity.y);

    stats.replaceChildren(buildEntityStats(currentEntity, segCount, photosynthesisMultiplier, nutrientAtCom, currentSpeed));

    const incomeStats = automationExperiment ? automationExperiment.getIncomeStats() : this.simulation.getIncomeStats();
    income.replaceChildren(buildIncomePanel(incomeStats));

    this.updateFamilyTree();
  }

  private updateFamilyTree(): void {
    const familyContainer = document.getElementById('entityFamily')!;
    const automationExperiment = this.getActiveAutomationExperiment();
    const maxVisibleRelatives = 18;

    if (!this.selectedEntity || this.selectedEntity.dead) {
      this.setSelectedEntityHasRelatives(false);
      familyContainer.innerHTML = '';
      familyContainer.style.removeProperty('--family-columns');
      this.lastRenderedRelativeIds.clear();
      return;
    }

    const relatives = automationExperiment
      ? automationExperiment.getLivingRelatives(this.selectedEntity.id)
      : this.simulation.getLivingRelatives(this.selectedEntity.id);
    const relativeInfos: RelativeInfo[] = relatives.map((relative) => ({
      entity: relative.entity,
      relationship: relative.relationship,
    }));
    sortRelatives(relativeInfos);
    const visibleRelatives = relativeInfos.slice(0, maxVisibleRelatives);

    this.setSelectedEntityHasRelatives(visibleRelatives.length > 0);
    const currentIds = new Set(visibleRelatives.map(relative => relative.entity.id));

    let grid = familyContainer.querySelector('.family-grid') as HTMLElement;
    const domIds = grid
      ? new Set([...grid.querySelectorAll('[data-entity-id]')].map(el => parseInt((el as HTMLElement).dataset.entityId || '0')))
      : new Set<number>();

    const addedIds = [...currentIds].filter(id => !domIds.has(id));
    const removedIds = [...domIds].filter(id => !currentIds.has(id));

    if (addedIds.length === 0 && removedIds.length === 0) {
      return;
    }

    this.lastRenderedRelativeIds = currentIds;

    if (visibleRelatives.length === 0) {
      familyContainer.innerHTML = '';
      familyContainer.style.removeProperty('--family-columns');
      return;
    }

    familyContainer.style.setProperty('--family-columns', String(Math.max(1, Math.min(6, visibleRelatives.length))));

    if (!grid) {
      const container = document.createElement('div');
      const header = document.createElement('div');
      header.className = 'entity-family-header';
      header.textContent = 'Relatives';
      container.appendChild(header);

      grid = document.createElement('div');
      grid.className = 'family-grid';
      container.appendChild(grid);

      familyContainer.innerHTML = '';
      familyContainer.appendChild(container);
    }

    for (const id of removedIds) {
      const member = grid.querySelector(`[data-entity-id="${id}"]`);
      if (member) member.remove();
    }

    for (const relative of visibleRelatives) {
      if (!relative.entity.name) {
        relative.entity.name = generateEntityName();
      }
    }

    for (const relative of visibleRelatives) {
      if (!domIds.has(relative.entity.id)) {
        const member = buildFamilyMember(
          relative,
          (canvas, entity) => this.renderer.renderEntityPreview(entity, canvas),
          (entity) => {
            this.selectedEntity = entity;
            this.syncSelectedEntityOnActiveRenderer();
            this.startTrackingSelectedEntity(entity.id);
            this.lastPreviewedEntityId = null;
            this.lastRenderedRelativeIds.clear();
            this.updateEntityInfo();
            if (this.selectedEntity) {
              this.centerCameraOnEntity(this.selectedEntity);
            }
          }
        );
        grid.appendChild(member);
      }
    }

    for (const relative of visibleRelatives) {
      const member = grid.querySelector(`[data-entity-id="${relative.entity.id}"]`);
      if (member && member.parentElement) {
        member.parentElement.appendChild(member);
      }
    }
  }

  private updateStats(): void {
    const automationExperiment = automationController.isRunning()
      ? automationController.getCurrentExperiment()
      : null;
    const automationStatus = automationExperiment ? automationExperiment.getStatus() : null;

    const population = automationStatus
      ? automationStatus.population
      : this.simulation.getPopulation();
    const generation = automationStatus
      ? automationStatus.generation
      : this.simulation.generation;
    const queued = automationExperiment
      ? automationExperiment.getQueuedCount()
      : this.simulation.getQueuedCount();
    const medianAgeMs = automationExperiment
      ? automationExperiment.getMedianAgeMs()
      : this.simulation.getMedianAgeMs();
    const simTimeSec = automationExperiment
      ? automationExperiment.getElapsedTimeSec()
      : this.simulation.getSimulationTimeSec();

    document.getElementById('population')!.textContent = population.toString();
    document.getElementById('generation')!.textContent = generation.toString();
    document.getElementById('queued')!.textContent = queued.toString();
    document.getElementById('medianAge')!.textContent = Math.round(medianAgeMs / 1000) + 's';

    const minutes = Math.floor(simTimeSec / 60);
    const secs = Math.floor(simTimeSec % 60);
    document.getElementById('time')!.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;

    const displayValue = automationController.isRunning()
      ? automationController.getSpeedMultiplier()
      : this.speed;
    this.speedMultiplierText.textContent = displayValue >= 10
      ? displayValue.toFixed(0) + 'x'
      : displayValue.toFixed(1) + 'x';
  }

  private updateFrameTime(smoothedCalcTimePerFrame: number): void {
    this.calcTimeText.textContent = `${smoothedCalcTimePerFrame.toFixed(1)} ms`;

    const idealMs = PERFORMANCE_CONTROL_CONSTANTS.idealFrameTimeMs;
    const scale = Math.max(smoothedCalcTimePerFrame, idealMs);

    const fillPercent = (smoothedCalcTimePerFrame / scale) * 100;
    const idealPercent = (idealMs / scale) * 100;

    this.calcTimeFill.style.width = `${fillPercent}%`;
    this.calcTimeIdeal.style.left = `${idealPercent}%`;

    this.calcTimeFill.classList.remove('warning', 'critical');
    if (smoothedCalcTimePerFrame > idealMs * 2) {
      this.calcTimeFill.classList.add('critical');
    } else if (smoothedCalcTimePerFrame > idealMs) {
      this.calcTimeFill.classList.add('warning');
    }
  }

  start(): void {
    this.lastTimeMs = performance.now();
    this.lastUIUpdateTimeMs = this.lastTimeMs;
    this.loop();
  }

  private createFrameMode(): FrameMode {
    const isAutomation = automationController.isRunning();
    if (isAutomation) {
      return {
        isAutomation: true,
        shouldRunFrame: true,
        maximizeStepsPerFrame: true,
        isIdleDynamicFrame: false,
        targetFrameTimeMs: PERFORMANCE_CONTROL_CONSTANTS.automationTargetFrameTimeMs * PERFORMANCE_CONTROL_CONSTANTS.targetRatio,
        stepSimulation: (simDtSec) => {
          automationController.getCurrentExperiment()?.step(simDtSec);
        },
        finalizeFrame: async () => {
          await automationController.step();
        },
        onFrameBudgetExceeded: (stepIndex) => {
          automationController.adjustSpeed(Math.max(
            PERFORMANCE_CONTROL_CONSTANTS.minSpeedMultiplier,
            Math.min(PERFORMANCE_CONTROL_CONSTANTS.maxSpeedMultiplier, stepIndex)
          ));
        },
      };
    }

    const maximizeStepsPerFrame = this.dynamicSpeed;
    const isIdleDynamicFrame = this.dynamicSpeed && this.simulation.entities.length === 0;

    return {
      isAutomation: false,
      shouldRunFrame: this.running,
      maximizeStepsPerFrame,
      isIdleDynamicFrame,
      targetFrameTimeMs: PERFORMANCE_CONTROL_CONSTANTS.idealFrameTimeMs * PERFORMANCE_CONTROL_CONSTANTS.targetRatio,
      stepSimulation: (simDtSec) => {
        this.simulation.step(simDtSec);
      },
      finalizeFrame: async () => {
        this.renderSimulationFrame();
      },
      onFrameBudgetExceeded: (stepIndex) => {
        this.dynamicSpeedValue = Math.max(
          PERFORMANCE_CONTROL_CONSTANTS.minSpeedMultiplier,
          Math.min(PERFORMANCE_CONTROL_CONSTANTS.maxSpeedMultiplier, stepIndex)
        );
        this.setSpeed(this.dynamicSpeedValue);
      },
    };
  }

  private getFixedStepDtSec(frameMode: FrameMode): number {
    if (frameMode.isAutomation) {
      return automationController.getCurrentExperiment()?.getAutomationStepDtSec()
        ?? SIMULATION_TIMING_CONSTANTS.automationStepDtSec;
    }
    return SIMULATION_TIMING_CONSTANTS.standardStepDtSec * this.simulation.config.simulationTimeScale;
  }

  private renderSimulationFrame(): void {
    if (this.smoothedCalcTimeMs > 0) {
      const flashDuration = this.simulation.getFlashDuration();
      const showFlash = this.smoothedCalcTimeMs < flashDuration * 0.5;
      this.renderer.setShowFlashEffects(showFlash);
      this.simulation.setShowFlashEffects(showFlash);
    }

    this.renderer.render(this.simulation.entities, this.simulation.config, this.simulation.getEnvironmentField(), this.simulation.getSimulationTimeSec());
  }

  private loop = async (): Promise<void> => {
    const frameStart = performance.now();
    const now = frameStart;
    const frameInterval = now - this.lastTimeMs;
    const frameDtSec = frameInterval / 1000;
    this.lastTimeMs = now;

    const frameMode = this.createFrameMode();
    let stepsRunThisFrame = 0;

    if (frameMode.shouldRunFrame) {
      const fixedStepDtSec = this.getFixedStepDtSec(frameMode);
      const baseStepDtSec = frameMode.isAutomation
        ? SIMULATION_TIMING_CONSTANTS.automationStepDtSec
        : SIMULATION_TIMING_CONSTANTS.standardStepDtSec;

      if (frameMode.maximizeStepsPerFrame) {
        while (frameMode.shouldRunFrame) {
          const stepTsStart = performance.now();
          frameMode.stepSimulation(fixedStepDtSec);
          stepsRunThisFrame++;
          const stepTsEnd = performance.now();

          if (this.simulation.entities.length === 0 && !frameMode.isAutomation && this.dynamicSpeed) {
            this.dynamicSpeedValue = 1;
            this.setSpeed(this.dynamicSpeedValue);
            break;
          }
          if ((stepTsEnd - stepTsStart) + (stepTsEnd - frameStart) > frameMode.targetFrameTimeMs) {
            frameMode.onFrameBudgetExceeded(stepsRunThisFrame);
            break;
          }
        }
      } else {
        this.physicsAccumulatorSec += frameDtSec * this.speed;
        const maxSteps = Math.ceil(this.speed);

        while (this.physicsAccumulatorSec >= baseStepDtSec && stepsRunThisFrame < maxSteps) {
          frameMode.stepSimulation(fixedStepDtSec);
          this.physicsAccumulatorSec -= baseStepDtSec;
          stepsRunThisFrame++;

          if (!this.dynamicSpeed && this.manualSpeed > 1) {
            if (performance.now() - frameStart > PERFORMANCE_CONTROL_CONSTANTS.manualSpeedThrottleFrameTimeMs) {
              const lowerPowerOfTwo = Math.pow(2, Math.floor(Math.log2(this.manualSpeed)) - 1);
              this.manualSpeed = Math.max(1, lowerPowerOfTwo);
              this.setSpeed(this.manualSpeed);
              this.physicsAccumulatorSec = 0;
              break;
            }
          }
        }

        if (this.physicsAccumulatorSec > baseStepDtSec) {
          this.physicsAccumulatorSec = this.physicsAccumulatorSec % baseStepDtSec;
        }
      }
    }

    await frameMode.finalizeFrame();

    const calcTime = performance.now() - frameStart;

    if (this.collectPacingDebug) {
      this.pacingDebugHistory.push({
        frameDtMs: frameInterval,
        stepsRun: stepsRunThisFrame,
        accumulatorSec: frameMode.maximizeStepsPerFrame ? -1 : this.physicsAccumulatorSec,
        calcTimeMs: calcTime,
      });
      const maxPacingHistory = 180;
      if (this.pacingDebugHistory.length > maxPacingHistory) {
        this.pacingDebugHistory.shift();
      }
    }

    this.calcTimePerFrameHistory.push(calcTime);
    if (this.calcTimePerFrameHistory.length > PERFORMANCE_CONTROL_CONSTANTS.calcTimePerFrameHistorySize) {
      this.calcTimePerFrameHistory.shift();
    }

    this.smoothedCalcTimeMs = this.calcTimePerFrameHistory.reduce((a, b) => a + b, 0) / this.calcTimePerFrameHistory.length;

    if (!this.dynamicSpeed && this.manualSpeed > 1) {
      if (this.smoothedCalcTimeMs > PERFORMANCE_CONTROL_CONSTANTS.manualSpeedThrottleFrameTimeMs) {
        const lowerPowerOfTwo = Math.pow(2, Math.floor(Math.log2(this.manualSpeed)) - 1);
        this.manualSpeed = Math.max(1, lowerPowerOfTwo);
        this.setSpeed(this.manualSpeed);
      }
    }

    this.frameCount++;

    if (now - this.lastUIUpdateTimeMs >= PANEL_CONSTANTS.uiUpdateIntervalMs) {
      this.lastUIUpdateTimeMs = now;
      this.updateStats();
      this.updateFrameTime(this.smoothedCalcTimeMs);
      this.syncRendererVisibilityFlags();
      this.syncSelectedEntityOnActiveRenderer();

      if (this.selectedEntity) {
        if (this.selectedEntity.dead) {
          this.selectedEntity = null;
          this.displayedGenome = '';
          this.syncSelectedEntityOnActiveRenderer();
          this.stopTrackingSelectedEntity();
          document.getElementById('selectedEntity')!.classList.add('hidden');
        } else {
          this.updateEntityInfo();
        }
      }
    }

    requestAnimationFrame(this.loop);
  };
}
