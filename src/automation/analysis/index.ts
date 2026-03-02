import { analyzeCorrelations } from './correlations';
import { generateCensusChangeRankings, analyzeCensusChanges } from './censusChanges';
import { generateCategories } from './categories';
import { generateRankings } from './rankings';
import { analyzeSettingsImpact } from './settingsImpact';
import { analyzeSensitivity } from './sensitivity';
import { buildRunAnalysis, generateAnalysisSummary as generateCompactAnalysisSummary } from './summary';
import { AnalysisOutput, AnalysisSummary, AnalysisSummaryOptions, ExperimentResult, RunAnalysis } from './types';
import { getFinalCensus } from './utils';

export function generateAnalysis(results: ExperimentResult[]): AnalysisOutput {
  const runs: RunAnalysis[] = results.map(r => {
    const censusData = r.censusData || [];
    const changeAnalysis = censusData.length >= 2
      ? analyzeCensusChanges(r.id, censusData)
      : undefined;
    return {
      runId: r.id,
      settings: r.settings as Record<string, unknown>,
      finalCensus: getFinalCensus(censusData),
      censusData,
      summary: r.summary,
      censusChange: changeAnalysis,
    };
  });

  const survivingRuns = runs.filter(r => !r.summary.collapseEvent);
  const collapsedRuns = runs.filter(r => r.summary.collapseEvent);

  const rankings = generateRankings(runs);
  const categories = generateCategories(runs);
  const settingsImpact = analyzeSettingsImpact(runs);
  const correlations = analyzeCorrelations(runs);
  const censusChangeRankings = generateCensusChangeRankings(runs);

  return {
    generatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    survivingRuns: survivingRuns.length,
    collapsedRuns: collapsedRuns.length,
    rankings,
    categories,
    settingsImpact,
    correlations,
    censusChangeRankings,
  };
}

export { analyzeSensitivity };

export function generateAnalysisSummary(results: ExperimentResult[], options: AnalysisSummaryOptions = {}): AnalysisSummary {
  const runs = buildRunAnalysis(results);
  return generateCompactAnalysisSummary(runs, options);
}

export type {
  AnalysisOutput,
  AnalysisSummary,
  AnalysisSummaryOptions,
  ExperimentResult,
  RunAnalysis,
} from './types';
