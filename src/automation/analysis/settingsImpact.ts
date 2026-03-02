import { RunAnalysis, SettingsImpactAnalysis } from './types';
import { getMetricValue, trunc } from './utils';

function getVariedNumericParameterNames(runs: RunAnalysis[]): string[] {
  const numericValues = new Map<string, Set<number>>();

  for (const run of runs) {
    for (const [key, value] of Object.entries(run.settings)) {
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      if (!numericValues.has(key)) {
        numericValues.set(key, new Set<number>());
      }
      numericValues.get(key)!.add(value);
    }
  }

  const varied: string[] = [];
  for (const [key, values] of numericValues.entries()) {
    if (values.size > 1) {
      varied.push(key);
    }
  }

  varied.sort((a, b) => a.localeCompare(b));
  return varied;
}

export function analyzeSettingsImpact(runs: RunAnalysis[]): SettingsImpactAnalysis[] {
  const parameterNames = getVariedNumericParameterNames(runs);

  return parameterNames.map(param => {
    const valueGroups = new Map<number, RunAnalysis[]>();

    for (const run of runs) {
      const value = run.settings[param];
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      if (!valueGroups.has(value)) {
        valueGroups.set(value, []);
      }
      valueGroups.get(value)!.push(run);
    }

    const impact = Array.from(valueGroups.entries()).map(([value, groupRuns]) => {
      const surviving = groupRuns.filter(r => !r.summary.collapseEvent);
      const populations = surviving.map(r => r.summary.finalPopulation);
      const diversities = surviving.map(r => r.summary.meanDiversity);
      const densityVariances = surviving.map(r => getMetricValue(r.finalCensus, 'densityVariance'));

      const avgPop = populations.length > 0
        ? populations.reduce((a, b) => a + b, 0) / populations.length
        : 0;
      const avgDiv = diversities.length > 0
        ? diversities.reduce((a, b) => a + b, 0) / diversities.length
        : 0;
      const avgDv = densityVariances.length > 0
        ? densityVariances.reduce((a, b) => a + b, 0) / densityVariances.length
        : 0;
      const collapseRate = groupRuns.length > 0
        ? (groupRuns.length - surviving.length) / groupRuns.length
        : 0;

      return [value, trunc(avgPop), trunc(avgDiv), trunc(avgDv), trunc(collapseRate)] as [number, number, number, number, number];
    });

    impact.sort((a, b) => {
      return a[0] - b[0];
    });

    return {
      parameter: param,
      fields: ['value', 'avgPopulation', 'avgDiversity', 'avgDensityVariance', 'collapseRate'],
      impact,
    };
  });
}
