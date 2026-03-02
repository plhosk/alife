import fs from 'node:fs';
import path from 'node:path';
import { generateSaltelliManifest } from '../src/automation/sampling/sobol-matrices.ts';

/* eslint-disable no-undef */

function getParameterRangesForPreset(preset) {
  if (preset === 'ecosystem-12d') {
    return [
      { name: 'photosynthesisRate', min: 0, max: 14, quantize: { step: 0.1, min: 0, max: 14 } },
      { name: 'environmentNutrientPhotosynthMinMultiplier', min: 0, max: 1, quantize: { step: 0.01, min: 0, max: 1 } },
      { name: 'environmentNutrientConsumptionRate', min: 0, max: 3, quantize: { step: 0.025, min: 0, max: 3 } },
      { name: 'locomotorFoodCost', min: 0, max: 0.01, quantize: { step: 0.0001, min: 0, max: 0.01 } },
      { name: 'impulseNutrientDemandRate', min: 0, max: 0.01, quantize: { step: 0.0002, min: 0, max: 0.01 } },
      { name: 'environmentLocomotorNutrientToFoodScale', min: 0, max: 30, quantize: { step: 0.25, min: 0, max: 30 } },
      { name: 'attackDamagePerLength', min: 0, max: 20, quantize: { step: 0.2, min: 0, max: 20 } },
      { name: 'foodStealPerDamage', min: 0, max: 5, quantize: { step: 0.1, min: 0, max: 5 } },
      { name: 'locomotorImpulsePerLength', min: 0, max: 280, quantize: { step: 2, min: 0, max: 280 } },
      { name: 'environmentNutrientRegenRate', min: 0, max: 1, quantize: { step: 0.01, min: 0, max: 1 } },
      { name: 'environmentFootprintScale', min: 0.1, max: 2.5, quantize: { step: 0.05, min: 0.1, max: 2.5 } },
      { name: 'maxPopulation', min: 100, max: 500, round: true },
    ];
  }

  if (preset === 'test-3d') {
    return [
      { name: 'paramA', min: 0, max: 1 },
      { name: 'paramB', min: 0, max: 1 },
      { name: 'paramC', min: 0, max: 1 },
    ];
  }

  return [
    { name: 'photosynthesisRate', min: 0.5, max: 2.0 },
    { name: 'environmentNutrientPhotosynthMinMultiplier', min: 0.5, max: 2.0 },
    { name: 'environmentNutrientConsumptionRate', min: 0.001, max: 0.02 },
    { name: 'locomotorFoodCost', min: 0.1, max: 0.5 },
    { name: 'impulseNutrientDemandRate', min: 0.01, max: 0.1 },
    { name: 'environmentLocomotorNutrientToFoodScale', min: 0.1, max: 1.0 },
    { name: 'attackDamagePerLength', min: 0.5, max: 3.0 },
    { name: 'foodStealPerDamage', min: 0.1, max: 0.5 },
    { name: 'locomotorImpulsePerLength', min: 0.5, max: 2.0 },
    { name: 'environmentNutrientRegenRate', min: 0.01, max: 0.1 },
    { name: 'environmentFootprintScale', min: 0.5, max: 2.0 },
    { name: 'maxPopulation', min: 100, max: 500 },
  ];
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0] === '--help') {
    console.log('Usage: node scripts/saltelli-experiment.mjs <N> [preset] [output-dir]');
    console.log('');
    console.log('Arguments:');
    console.log('  N           Sample size (e.g., 64, 128, 256)');
    console.log('  preset      Parameter preset: default, ecosystem-12d, test-3d (default: default)');
    console.log('  output-dir  Output directory (default: ./saltelli-experiment)');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/saltelli-experiment.mjs 64 ecosystem-12d ./saltelli-exp');
    process.exit(args[0] === '--help' ? 0 : 1);
  }

  const N = parseInt(args[0]) || 64;
  const preset = args[1] || 'default';
  const outputDir = args[2] || './saltelli-experiment';

  const ranges = getParameterRangesForPreset(preset);
  const manifest = generateSaltelliManifest(N, ranges, preset);

  const resolvedDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const manifestPath = path.join(resolvedDir, 'saltelli-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('Generated Saltelli experiment manifest:');
  console.log('  Method: sobol-saltelli');
  console.log(`  Preset: ${preset}`);
  console.log(`  Sample size (N): ${N}`);
  console.log(`  Parameters (k): ${ranges.length}`);
  console.log(`  Total runs: ${manifest.totalRuns} (N × (k + 2) = ${N} × ${ranges.length + 2})`);
  console.log(`  Output: ${manifestPath}`);
}

main();
