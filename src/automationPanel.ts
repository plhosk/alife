import { automationController, PRESETS } from './automation/automation';
import {
  estimateTotalDuration,
  formatDuration,
  formatParameterName,
  formatParameterValue,
  getVariedParameters,
} from './automation/automationPresets';
import { getAutomationDefaultRanges } from './configSliders';

  interface AutomationUI {
  toggleBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  panel: HTMLElement;
  playPauseBtn: HTMLButtonElement;
  presetSelect: HTMLSelectElement;
  startStopBtn: HTMLButtonElement;
  presetDescription: HTMLElement;
  presetSummary: HTMLElement;
  presetParameters: HTMLTextAreaElement;
  progressFill: HTMLElement;
  progressText: HTMLElement;
  progressTextRight: HTMLElement;
  buttonProgress: HTMLElement;
  currentExperimentInfo: HTMLElement;
  currentExpId: HTMLElement;
  currentExpTime: HTMLElement;
  currentExpPop: HTMLElement;
  currentExpDt: HTMLElement;
  currentExpSpeed: HTMLElement;
  currentExpSeeds: HTMLElement;
  resultsCount: HTMLElement;
  censusCount: HTMLElement;
  finalCensusCount: HTMLElement;
  mosaicCount: HTMLElement;
  finalMosaicCount: HTMLElement;
  screenshotsCount: HTMLElement;
  finalScreenshotsCount: HTMLElement;
  analysisCount: HTMLElement;
  downloadProgress: HTMLElement;
  downloadProgressFill: HTMLElement;
  downloadProgressText: HTMLElement;
  downloadButtons: {
    results: HTMLButtonElement;
    census: HTMLButtonElement;
    finalCensus: HTMLButtonElement;
    mosaic: HTMLButtonElement;
    finalMosaic: HTMLButtonElement;
    screenshots: HTMLButtonElement;
    finalScreenshots: HTMLButtonElement;
    analysis: HTMLButtonElement;
    analysisSummary: HTMLButtonElement;
    all: HTMLButtonElement;
  };
}

interface AutomationLaunchOptions {
  presetSlug: string | null;
  autoStart: boolean;
  delayMs: number;
}

function toPresetSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function readAutomationLaunchOptions(): AutomationLaunchOptions {
  const params = new URLSearchParams(window.location.search);
  const presetRaw = params.get('automationPreset') ?? params.get('preset');
  const autoStartRaw = params.get('automationAutoStart') ?? params.get('autostart');
  const delayRaw = params.get('automationDelayMs') ?? params.get('delayMs') ?? params.get('delay');
  const autoStart = autoStartRaw === '1' || autoStartRaw === 'true' || autoStartRaw === 'yes';

  let delayMs = 1500;
  if (delayRaw !== null) {
    const parsedDelay = Number.parseInt(delayRaw, 10);
    if (Number.isFinite(parsedDelay) && parsedDelay >= 0) {
      delayMs = parsedDelay;
    }
  }

  return {
    presetSlug: presetRaw ? toPresetSlug(presetRaw) : null,
    autoStart,
    delayMs,
  };
}

export interface AutomationPanelOptions {
  canvas: HTMLCanvasElement;
  speedSelect: HTMLSelectElement;
  playPauseBtn: HTMLButtonElement;
  setSpeed: (speed: number) => void;
  resetSimulation: () => void;
  updateUIState: () => void;
  getLastProgressUpdateMs: () => number;
  setLastProgressUpdateMs: (timeMs: number) => void;
  onLayoutChange: (anchor: 'left' | 'right') => void;
  scrollPanelDockToEnd: () => void;
}

function getAutomationUI(): AutomationUI {
  return {
    toggleBtn: document.getElementById('toggleAutomationPane') as HTMLButtonElement,
    closeBtn: document.getElementById('closeAutomation') as HTMLButtonElement,
    panel: document.getElementById('automationPanel') as HTMLElement,
    playPauseBtn: document.getElementById('playPause') as HTMLButtonElement,
    presetSelect: document.getElementById('presetSelect') as HTMLSelectElement,
    startStopBtn: document.getElementById('toggleAutomation') as HTMLButtonElement,
    presetDescription: document.getElementById('presetDescription') as HTMLElement,
    presetSummary: document.getElementById('presetSummary') as HTMLElement,
    presetParameters: document.getElementById('presetParameters') as HTMLTextAreaElement,
    progressFill: document.getElementById('automationProgressFill') as HTMLElement,
    progressText: document.getElementById('automationProgressText') as HTMLElement,
    progressTextRight: document.getElementById('automationProgressTextRight') as HTMLElement,
    buttonProgress: document.getElementById('automationButtonProgress') as HTMLElement,
    currentExperimentInfo: document.getElementById('currentExperimentInfo') as HTMLElement,
    currentExpId: document.getElementById('currentExpId') as HTMLElement,
    currentExpTime: document.getElementById('currentExpTime') as HTMLElement,
    currentExpPop: document.getElementById('currentExpPop') as HTMLElement,
    currentExpDt: document.getElementById('currentExpDt') as HTMLElement,
    currentExpSpeed: document.getElementById('currentExpSpeed') as HTMLElement,
    currentExpSeeds: document.getElementById('currentExpSeeds') as HTMLElement,
    resultsCount: document.getElementById('resultsCount') as HTMLElement,
    censusCount: document.getElementById('censusCount') as HTMLElement,
    finalCensusCount: document.getElementById('finalCensusCount') as HTMLElement,
    mosaicCount: document.getElementById('mosaicCount') as HTMLElement,
    finalMosaicCount: document.getElementById('finalMosaicCount') as HTMLElement,
    screenshotsCount: document.getElementById('screenshotsCount') as HTMLElement,
    finalScreenshotsCount: document.getElementById('finalScreenshotsCount') as HTMLElement,
    analysisCount: document.getElementById('analysisCount') as HTMLElement,
    downloadProgress: document.getElementById('downloadProgress') as HTMLElement,
    downloadProgressFill: document.getElementById('downloadProgressFill') as HTMLElement,
    downloadProgressText: document.getElementById('downloadProgressText') as HTMLElement,
    downloadButtons: {
      results: document.getElementById('downloadResults') as HTMLButtonElement,
      census: document.getElementById('downloadCensus') as HTMLButtonElement,
      finalCensus: document.getElementById('downloadFinalCensus') as HTMLButtonElement,
      mosaic: document.getElementById('downloadMosaic') as HTMLButtonElement,
      finalMosaic: document.getElementById('downloadFinalMosaic') as HTMLButtonElement,
      screenshots: document.getElementById('downloadScreenshots') as HTMLButtonElement,
      finalScreenshots: document.getElementById('downloadFinalScreenshots') as HTMLButtonElement,
      analysis: document.getElementById('downloadAnalysis') as HTMLButtonElement,
      analysisSummary: document.getElementById('downloadAnalysisSummary') as HTMLButtonElement,
      all: document.getElementById('downloadAll') as HTMLButtonElement,
    }
  };
}

export function setupAutomationPanel(options: AutomationPanelOptions): void {
  const ui = getAutomationUI();
  const launchOptions = readAutomationLaunchOptions();
  const nonlinearSobolRanges = Object.entries(getAutomationDefaultRanges())
    .filter(([, range]) => typeof range.samplingExponent === 'number' && Number.isFinite(range.samplingExponent) && range.samplingExponent !== 1)
    .map(([key, range]) => {
      const exponent = range.samplingExponent!;
      const exponentLabel = Number.isInteger(exponent) ? exponent.toString() : exponent.toFixed(2);
      return {
        key,
        label: `${formatParameterName(key)} (x^${exponentLabel})`,
      };
    });

  const formatSpeedMultiplier = (value: number): string => {
    return value >= 10 ? value.toFixed(0) + 'x' : value.toFixed(1) + 'x';
  };

  const setLines = (container: HTMLElement | HTMLTextAreaElement, lines: string[]): void => {
    if (container instanceof HTMLTextAreaElement) {
      container.value = lines.join('\n');
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const row = document.createElement('div');
      row.textContent = line;
      fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
  };

  const getUniformNumericValue = (preset: (typeof PRESETS)[number], key: string): number | null => {
    const values = preset.parameterSets.map((settings) => settings[key as keyof typeof settings]);
    if (values.length === 0 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null;
    }

    const first = values[0] as number;
    return values.every((value) => Math.abs((value as number) - first) <= 1e-12) ? first : null;
  };

  const formatSeedPolicy = (baseSeed: number | null, runStep: number | null): string | null => {
    if (baseSeed === null && runStep === null) {
      return null;
    }

    const basePart = baseSeed === null
      ? 'auto'
      : formatParameterValue('initialRandomSeed', baseSeed);
    const stepPart = runStep === null
      ? ''
      : `, ${runStep >= 0 ? '+' : ''}${formatParameterValue('initialRandomSeedPerRunStep', runStep)}/run`;
    return `${basePart}${stepPart}`;
  };

  const disableAllDownloadButtons = (): void => {
    ui.downloadButtons.results.disabled = true;
    ui.downloadButtons.census.disabled = true;
    ui.downloadButtons.finalCensus.disabled = true;
    ui.downloadButtons.mosaic.disabled = true;
    ui.downloadButtons.finalMosaic.disabled = true;
    ui.downloadButtons.screenshots.disabled = true;
    ui.downloadButtons.finalScreenshots.disabled = true;
    ui.downloadButtons.analysis.disabled = true;
    ui.downloadButtons.analysisSummary.disabled = true;
    ui.downloadButtons.all.disabled = true;
  };

  const updateDownloadButtonStates = (): void => {
    ui.downloadButtons.results.disabled = !automationController.hasResults();
    ui.downloadButtons.census.disabled = !automationController.hasCensus();
    ui.downloadButtons.finalCensus.disabled = !automationController.hasFinalCensus();
    ui.downloadButtons.mosaic.disabled = !automationController.hasMosaic();
    ui.downloadButtons.finalMosaic.disabled = !automationController.hasFinalMosaic();
    ui.downloadButtons.screenshots.disabled = !automationController.hasScreenshots();
    ui.downloadButtons.finalScreenshots.disabled = !automationController.hasFinalScreenshots();
    ui.downloadButtons.analysis.disabled = !automationController.hasAnalysis();
    ui.downloadButtons.analysisSummary.disabled = !automationController.hasAnalysis();
    ui.downloadButtons.all.disabled = !automationController.canDownloadAll();
  };

  const resetDownloadCounts = (): void => {
    ui.resultsCount.textContent = '0';
    ui.censusCount.textContent = '0';
    ui.finalCensusCount.textContent = '0';
    ui.mosaicCount.textContent = '0';
    ui.finalMosaicCount.textContent = '0';
    ui.screenshotsCount.textContent = '0';
    ui.finalScreenshotsCount.textContent = '0';
    ui.analysisCount.textContent = '0';
  };

  const updateDownloadCounts = (): void => {
    ui.resultsCount.textContent = automationController.getResultsCount().toString();
    ui.censusCount.textContent = automationController.getCensusCount().toString();
    ui.finalCensusCount.textContent = automationController.getFinalCensusCount().toString();
    ui.mosaicCount.textContent = automationController.getMosaicCount().toString();
    ui.finalMosaicCount.textContent = automationController.getFinalMosaicCount().toString();
    ui.screenshotsCount.textContent = automationController.getScreenshotsCount().toString();
    ui.finalScreenshotsCount.textContent = automationController.getFinalScreenshotsCount().toString();
    ui.analysisCount.textContent = automationController.getAnalysisCount().toString();
  };

  const setStartStopState = (running: boolean): void => {
    ui.startStopBtn.textContent = running ? 'Stop' : 'Start';
    ui.startStopBtn.classList.toggle('danger', running);
    ui.startStopBtn.classList.toggle('success', !running);
    ui.presetSelect.disabled = running;
    ui.startStopBtn.disabled = !running && ui.presetSelect.selectedIndex <= 0;
  };

  disableAllDownloadButtons();
  automationController.setCanvas(options.canvas);

  const setAutomationPanelVisible = (visible: boolean): void => {
    ui.panel.classList.toggle('panel-collapsed', !visible);
    ui.toggleBtn.classList.toggle('panel-toggle-open', visible);
    options.onLayoutChange('left');
    options.scrollPanelDockToEnd();
  };

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

  bindPanelTogglePress(ui.toggleBtn, () => {
    setAutomationPanelVisible(ui.panel.classList.contains('panel-collapsed'));
  });

  ui.closeBtn.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setAutomationPanelVisible(false);
  });

  ui.toggleBtn.classList.toggle('panel-toggle-open', !ui.panel.classList.contains('panel-collapsed'));

  if (launchOptions.presetSlug || launchOptions.autoStart) {
    setAutomationPanelVisible(true);
  }

  while (ui.presetSelect.options.length > 1) {
    ui.presetSelect.remove(1);
  }
  for (const preset of PRESETS) {
    const option = document.createElement('option');
    option.value = toPresetSlug(preset.name);
    option.textContent = preset.name;
    ui.presetSelect.appendChild(option);
  }

  ui.presetSelect.selectedIndex = 0;

  const updatePresetDisplay = (): void => {
    const selectedIdx = ui.presetSelect.selectedIndex - 1;
    if (selectedIdx < 0 || selectedIdx >= PRESETS.length) {
      ui.presetDescription.textContent = '';
      setLines(ui.presetSummary, []);
      setLines(ui.presetParameters, []);
      setStartStopState(false);
      return;
    }

    const preset = PRESETS[selectedIdx];
    automationController.selectPreset(preset);
    ui.presetDescription.textContent = preset.description;

    const totalDuration = estimateTotalDuration(preset);
    const sameRunCount = Math.max(1, preset.sameRunCount ?? 1);
    const totalExperiments = preset.parameterSets.length * sameRunCount;
    const configCount = preset.parameterSets.length;
    const summaryLines = [
      `${totalExperiments} experiment runs (${configCount} configs${sameRunCount > 1 ? ` × ${sameRunCount}` : ''})`,
      `${preset.durationSec}s each`,
      `Census every ${preset.censusIntervalSec}s`,
      `Est. total: ${formatDuration(totalDuration)} (sim time)`
    ];
    if (preset.samplingSummary) {
      summaryLines.splice(1, 0, `Sampling: ${preset.samplingSummary}`);
    }
    if (preset.screenshotIntervalSec > 0) {
      summaryLines.splice(summaryLines.length - 1, 0, `Screenshots every ${preset.screenshotIntervalSec}s`);
    }

    const initialSeed = getUniformNumericValue(preset, 'initialRandomSeed');
    const initialSeedPerRun = getUniformNumericValue(preset, 'initialRandomSeedPerRunStep');
    const evolutionSeed = getUniformNumericValue(preset, 'evolutionRandomSeed');
    const evolutionSeedPerRun = getUniformNumericValue(preset, 'evolutionRandomSeedPerRunStep');
    const initialSeedPolicy = formatSeedPolicy(initialSeed, initialSeedPerRun);
    const evolutionSeedPolicy = formatSeedPolicy(evolutionSeed, evolutionSeedPerRun);
    const seedSummaryParts: string[] = [];

    if (initialSeedPolicy !== null) {
      seedSummaryParts.push(`initial ${initialSeedPolicy}`);
    }
    if (evolutionSeedPolicy !== null) {
      seedSummaryParts.push(`evolution ${evolutionSeedPolicy}`);
    }

    if (seedSummaryParts.length > 0) {
      summaryLines.push(`Seeding: ${seedSummaryParts.join(' | ')}`);
    }

    setLines(ui.presetSummary, summaryLines);

    const variedParams = getVariedParameters(preset);
    const variedParamSet = new Set(variedParams);
    const seedKeys = new Set(['initialRandomSeed', 'initialRandomSeedPerRunStep', 'evolutionRandomSeed', 'evolutionRandomSeedPerRunStep']);
    const paramLines: string[] = [];
    const skipParams = new Set<string>();

    const fixedSettings: string[] = [];
    const firstSet = preset.parameterSets[0];
    if (firstSet) {
      const uniformKeys = Object.keys(firstSet).filter(key => !variedParamSet.has(key) && !seedKeys.has(key));
      const widthUniform = uniformKeys.includes('worldWidth');
      const heightUniform = uniformKeys.includes('worldHeight');
      if (widthUniform && heightUniform) {
        const w = getUniformNumericValue(preset, 'worldWidth');
        const h = getUniformNumericValue(preset, 'worldHeight');
        if (w !== null && h !== null && w === h) {
          fixedSettings.push(`size: ${formatParameterValue('worldWidth', w)}`);
          skipParams.add('worldWidth');
          skipParams.add('worldHeight');
        }
      }
      const popUniform = uniformKeys.includes('maxPopulation');
      if (popUniform) {
        const pop = getUniformNumericValue(preset, 'maxPopulation');
        if (pop !== null) {
          fixedSettings.push(`maxPopulation: ${formatParameterValue('maxPopulation', pop)}`);
          skipParams.add('maxPopulation');
        }
      }
    }

    const widthIdx = variedParams.indexOf('worldWidth');
    const heightIdx = variedParams.indexOf('worldHeight');
    if (widthIdx !== -1 && heightIdx !== -1) {
      const widthValues = preset.parameterSets.map(s => s.worldWidth).filter((v): v is number => v !== undefined);
      const heightValues = preset.parameterSets.map(s => s.worldHeight).filter((v): v is number => v !== undefined);
      const alwaysEqual = widthValues.length === heightValues.length && widthValues.every((w, i) => w === heightValues[i]);
      if (alwaysEqual) {
        const uniqueSizes = new Set(widthValues);
        const valueStr = Array.from(uniqueSizes).map(v => formatParameterValue('worldWidth', v)).join(', ');
        paramLines.push(`size: ${valueStr}`);
        skipParams.add('worldWidth');
        skipParams.add('worldHeight');
      }
    }

    for (const param of variedParams) {
      if (skipParams.has(param)) continue;
      const values = new Set(preset.parameterSets.map(s => s[param as keyof typeof preset.parameterSets[0]]));
      const valueStr = Array.from(values).map(v => typeof v === 'number' ? formatParameterValue(param, v) : v).join(', ');
      paramLines.push(`${formatParameterName(param)}: ${valueStr}`);
    }

    if (fixedSettings.length > 0) {
      if (paramLines.length > 0) {
        paramLines.push('');
      }
      paramLines.push('Fixed settings:');
      paramLines.push(...fixedSettings);
    }

    const fixedSeedLines: string[] = [];
    for (const key of seedKeys) {
      const value = getUniformNumericValue(preset, key);
      if (value === null || variedParamSet.has(key)) {
        continue;
      }
      fixedSeedLines.push(`${formatParameterName(key)}: ${formatParameterValue(key, value)}`);
    }

    if (fixedSeedLines.length > 0) {
      if (paramLines.length > 0) {
        paramLines.push('');
      }
      paramLines.push('Fixed controls:');
      paramLines.push(...fixedSeedLines);
    }

    const presetNonlinearSobolRanges = nonlinearSobolRanges
      .filter(range => variedParamSet.has(range.key))
      .map(range => range.label);

    if (presetNonlinearSobolRanges.length > 0) {
      if (paramLines.length > 0) {
        paramLines.push('');
      }
      paramLines.push(`Sobol nonlinear weighting: ${presetNonlinearSobolRanges.join(', ')}`);
    }

    setLines(ui.presetParameters, paramLines);

    setStartStopState(false);
  };

  ui.presetSelect.addEventListener('change', updatePresetDisplay);

  if (launchOptions.presetSlug) {
    const optionIndex = PRESETS.findIndex(preset => toPresetSlug(preset.name) === launchOptions.presetSlug);
    if (optionIndex >= 0) {
      ui.presetSelect.selectedIndex = optionIndex + 1;
    }
  }

  updatePresetDisplay();

  if (launchOptions.autoStart && ui.presetSelect.selectedIndex > 0) {
    window.setTimeout(() => {
      if (automationController.isRunning()) {
        return;
      }
      automationController.start();
    }, launchOptions.delayMs);
  }

  ui.startStopBtn.addEventListener('click', () => {
    if (automationController.isRunning()) {
      automationController.stop();
    } else {
      automationController.start();
    }
  });

  ui.downloadButtons.results.addEventListener('click', () => {
    automationController.downloadResults();
  });

  ui.downloadButtons.census.addEventListener('click', () => {
    automationController.downloadCensus();
  });

  ui.downloadButtons.finalCensus.addEventListener('click', () => {
    automationController.downloadFinalCensus();
  });

  ui.downloadButtons.mosaic.addEventListener('click', async () => {
    await automationController.downloadMosaic();
  });

  ui.downloadButtons.finalMosaic.addEventListener('click', async () => {
    await automationController.downloadFinalMosaic();
  });

  ui.downloadButtons.screenshots.addEventListener('click', async () => {
    await automationController.downloadScreenshots();
  });

  ui.downloadButtons.finalScreenshots.addEventListener('click', async () => {
    await automationController.downloadFinalScreenshots();
  });

  ui.downloadButtons.analysis.addEventListener('click', () => {
    automationController.downloadAnalysis();
  });

  ui.downloadButtons.analysisSummary.addEventListener('click', () => {
    automationController.downloadAnalysisSummary();
  });

  ui.downloadButtons.all.addEventListener('click', async () => {
    await automationController.downloadAll();
  });

  automationController.onStart(() => {
    options.setSpeed(1);
    options.speedSelect.value = '1';
    options.resetSimulation();
    setStartStopState(true);
    disableAllDownloadButtons();
    resetDownloadCounts();
    ui.buttonProgress.classList.remove('hidden');
    ui.buttonProgress.textContent = '0%';
    options.updateUIState();
  });

  automationController.onStop(() => {
    setStartStopState(false);
    updateDownloadButtonStates();
    updateDownloadCounts();
    ui.buttonProgress.classList.add('hidden');
    options.updateUIState();
  });

  automationController.onProgress((progress) => {
    const now = performance.now();
    if (now - options.getLastProgressUpdateMs() < 500) return;
    options.setLastProgressUpdateMs(now);

    updateDownloadButtonStates();
    updateDownloadCounts();

    const percent = ((progress.currentIndex + progress.currentExperimentTimeSec / progress.currentExperimentDurationSec) / progress.totalExperiments) * 100;
    ui.progressFill.style.width = `${percent}%`;
    ui.progressText.textContent = `${progress.currentIndex + 1}/${progress.totalExperiments} runs`;
    ui.buttonProgress.textContent = `${Math.round(percent)}%`;

    if (percent === 0) {
      ui.progressTextRight.textContent = '';
    } else {
      const elapsedTimeSec = (Date.now() - progress.startTimeMs) / 1000;
      const totalExpectedTime = elapsedTimeSec / percent * 100;
      const etaSeconds = Math.max(0, totalExpectedTime - elapsedTimeSec);
      const etaMinutes = Math.floor(etaSeconds / 60);
      const etaRemainingSeconds = Math.floor(etaSeconds % 60);
      ui.progressTextRight.textContent = etaMinutes > 0
        ? `ETA: ${etaMinutes} min ${etaRemainingSeconds} sec`
        : `ETA: ${etaRemainingSeconds} sec`;
    }

    ui.currentExperimentInfo.classList.remove('hidden');
    if (automationController.isRunning()) {
      const currentExp = automationController.getCurrentExperiment();
      if (currentExp) {
        ui.currentExpId.textContent = currentExp.getId();
        ui.currentExpTime.textContent = `${Math.round(progress.currentExperimentTimeSec)}s / ${progress.currentExperimentDurationSec}s`;
        ui.currentExpPop.textContent = progress.currentPopulation.toString();
        ui.currentExpDt.textContent = (progress.automationDtSec * 1000).toFixed(1) + 'ms';

        const speed = automationController.getSpeedMultiplier();
        ui.currentExpSpeed.textContent = formatSpeedMultiplier(speed);

        const settings = currentExp.getSettings();
        const initialSeed = settings.initialRandomSeed !== null && settings.initialRandomSeed !== undefined
          ? Math.trunc(settings.initialRandomSeed)
          : 'auto';
        const evolutionSeed = settings.evolutionRandomSeed !== null && settings.evolutionRandomSeed !== undefined
          ? Math.trunc(settings.evolutionRandomSeed)
          : 'auto';
        ui.currentExpSeeds.textContent = `init=${initialSeed} evo=${evolutionSeed}`;
      }
    } else {
      ui.currentExpId.textContent = '--';
      ui.currentExpTime.textContent = '--';
      ui.currentExpPop.textContent = '0';
      ui.currentExpDt.textContent = '--';
      ui.currentExpSpeed.textContent = '--';
      ui.currentExpSeeds.textContent = '--';
    }
    options.updateUIState();
  });

  automationController.onDownloadProgress((progress) => {
    if (progress.active) {
      ui.downloadProgress.classList.remove('hidden');
      const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
      ui.downloadProgressFill.style.width = `${percent}%`;
      ui.downloadProgressText.textContent = `${progress.stage} (${progress.current}/${progress.total})`;
      disableAllDownloadButtons();
    } else {
      ui.downloadProgress.classList.add('hidden');
      ui.downloadProgressFill.style.width = '0%';
      ui.downloadProgressText.textContent = '';
      updateDownloadButtonStates();
    }
  });
}
