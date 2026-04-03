import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface PipelineStage { name: string; type: 'build' | 'test' | 'security' | 'deploy'; required: boolean; duration: number }
interface PipelineRun { id: string; stages: PipelineStage[]; startedAt: Date; finishedAt?: Date; status: 'running' | 'success' | 'failure' }
interface Deployment { version: string; environment: string; timestamp: Date; success: boolean }
interface DORAMetrics { deploymentFrequency: number; leadTime: number; changeFailureRate: number; mttr: number }

// --- Implémentations ---

let runCounter = 0;

export function createPipeline(stages: PipelineStage[]): PipelineRun {
  return {
    id: `run-${++runCounter}`,
    stages,
    startedAt: new Date(),
    status: 'running',
  };
}

export function executePipeline(pipeline: PipelineRun): PipelineRun {
  const totalDuration = pipeline.stages.reduce((sum, s) => sum + s.duration, 0);
  const finishedAt = new Date(pipeline.startedAt.getTime() + totalDuration * 1000);
  return { ...pipeline, finishedAt, status: 'success' };
}

export function checkGates(results: Map<string, boolean>, requiredGates: string[]): boolean {
  return requiredGates.every(gate => results.get(gate) === true);
}

export function promoteToEnvironment(version: string, environments: string[], currentEnv: string): string | null {
  const idx = environments.indexOf(currentEnv);
  if (idx < 0 || idx >= environments.length - 1) return null;
  return environments[idx + 1];
}

export function calculateDORA(deployments: Deployment[], periodDays: number): DORAMetrics {
  if (deployments.length === 0) {
    return { deploymentFrequency: 0, leadTime: 0, changeFailureRate: 0, mttr: 0 };
  }

  const prodDeploys = deployments.filter(d => d.environment === 'production');
  const deploymentFrequency = prodDeploys.length / (periodDays / 7); // per week

  const successfulDeploys = prodDeploys.filter(d => d.success);
  const failedDeploys = prodDeploys.filter(d => !d.success);
  const changeFailureRate = prodDeploys.length > 0
    ? (failedDeploys.length / prodDeploys.length) * 100
    : 0;

  // Lead time: average time between deploys (simplified)
  let leadTime = 0;
  if (successfulDeploys.length >= 2) {
    const sorted = successfulDeploys.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let totalDiff = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalDiff += sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
    }
    leadTime = totalDiff / (sorted.length - 1) / (1000 * 60 * 60); // hours
  }

  // MTTR: average gap between failure and next success
  let mttr = 0;
  let mttrSamples = 0;
  for (const failure of failedDeploys) {
    const recovery = successfulDeploys.find(s => s.timestamp > failure.timestamp);
    if (recovery) {
      mttr += (recovery.timestamp.getTime() - failure.timestamp.getTime()) / (1000 * 60 * 60); // hours
      mttrSamples++;
    }
  }
  if (mttrSamples > 0) mttr = mttr / mttrSamples;

  return {
    deploymentFrequency: Math.round(deploymentFrequency * 10) / 10,
    leadTime: Math.round(leadTime * 10) / 10,
    changeFailureRate: Math.round(changeFailureRate * 10) / 10,
    mttr: Math.round(mttr * 10) / 10,
  };
}

export function classifyDORA(metrics: DORAMetrics): Record<string, 'elite' | 'high' | 'medium' | 'low'> {
  return {
    deploymentFrequency: metrics.deploymentFrequency >= 7 ? 'elite'
      : metrics.deploymentFrequency >= 1 ? 'high'
      : metrics.deploymentFrequency >= 0.25 ? 'medium'
      : 'low',
    leadTime: metrics.leadTime <= 24 ? 'elite'
      : metrics.leadTime <= 168 ? 'high'
      : metrics.leadTime <= 720 ? 'medium'
      : 'low',
    changeFailureRate: metrics.changeFailureRate <= 5 ? 'elite'
      : metrics.changeFailureRate <= 10 ? 'high'
      : metrics.changeFailureRate <= 15 ? 'medium'
      : 'low',
    mttr: metrics.mttr <= 1 ? 'elite'
      : metrics.mttr <= 24 ? 'high'
      : metrics.mttr <= 168 ? 'medium'
      : 'low',
  };
}

export function getPipelineDuration(pipeline: PipelineRun): number {
  return pipeline.stages.reduce((sum, s) => sum + s.duration, 0);
}

export function getFailureRate(runs: PipelineRun[]): number {
  if (runs.length === 0) return 0;
  const failed = runs.filter(r => r.status === 'failure').length;
  return Math.round((failed / runs.length) * 100);
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 10 — Projet Final CI/CD');

await test('createPipeline — crée un pipeline avec les stages', () => {
  const stages: PipelineStage[] = [
    { name: 'Build', type: 'build', required: true, duration: 120 },
    { name: 'Test', type: 'test', required: true, duration: 300 },
  ];
  const pipeline = createPipeline(stages);
  assertEqual(pipeline.stages.length, 2);
  assertEqual(pipeline.status, 'running');
  assert(pipeline.id.startsWith('run-'));
});

await test('executePipeline — exécute et complète le pipeline', () => {
  const stages: PipelineStage[] = [
    { name: 'Build', type: 'build', required: true, duration: 60 },
  ];
  const pipeline = createPipeline(stages);
  const completed = executePipeline(pipeline);
  assertEqual(completed.status, 'success');
  assert(completed.finishedAt !== undefined);
});

await test('checkGates — vérifie les quality gates', () => {
  const results = new Map<string, boolean>();
  results.set('lint', true);
  results.set('tests', true);
  results.set('coverage', false);
  assert(checkGates(results, ['lint', 'tests']));
  assert(!checkGates(results, ['lint', 'tests', 'coverage']));
});

await test('promoteToEnvironment — promeut au prochain environnement', () => {
  const envs = ['development', 'staging', 'production'];
  assertEqual(promoteToEnvironment('v1.0', envs, 'development'), 'staging');
  assertEqual(promoteToEnvironment('v1.0', envs, 'staging'), 'production');
  assertEqual(promoteToEnvironment('v1.0', envs, 'production'), null);
});

await test('calculateDORA — calcule les métriques DORA', () => {
  const now = new Date();
  const deployments: Deployment[] = [
    { version: 'v1', environment: 'production', timestamp: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), success: true },
    { version: 'v2', environment: 'production', timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), success: true },
    { version: 'v3', environment: 'production', timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), success: false },
    { version: 'v4', environment: 'production', timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), success: true },
  ];
  const dora = calculateDORA(deployments, 14);
  assert(dora.deploymentFrequency > 0);
  assert(dora.changeFailureRate > 0);
});

await test('classifyDORA — classe les performances DORA', () => {
  const elite: DORAMetrics = { deploymentFrequency: 10, leadTime: 12, changeFailureRate: 3, mttr: 0.5 };
  const result = classifyDORA(elite);
  assertEqual(result.deploymentFrequency, 'elite');
  assertEqual(result.leadTime, 'elite');
  assertEqual(result.changeFailureRate, 'elite');
  assertEqual(result.mttr, 'elite');
});

await test('getPipelineDuration — calcule la durée totale', () => {
  const stages: PipelineStage[] = [
    { name: 'Build', type: 'build', required: true, duration: 120 },
    { name: 'Test', type: 'test', required: true, duration: 300 },
    { name: 'Deploy', type: 'deploy', required: false, duration: 60 },
  ];
  assertEqual(getPipelineDuration(createPipeline(stages)), 480);
});

await test('getFailureRate — calcule le taux d\'échec', () => {
  const runs: PipelineRun[] = [
    { id: '1', stages: [], startedAt: new Date(), status: 'success' },
    { id: '2', stages: [], startedAt: new Date(), status: 'failure' },
    { id: '3', stages: [], startedAt: new Date(), status: 'success' },
    { id: '4', stages: [], startedAt: new Date(), status: 'success' },
  ];
  assertEqual(getFailureRate(runs), 25);
});

summary();
