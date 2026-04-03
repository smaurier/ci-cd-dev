import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface Instance { id: string; version: string; healthy: boolean }
interface CanaryMetrics { errorRate: number; p99Latency: number; successRate: number }

// --- Implémentations ---

export function rollingUpdate(instances: Instance[], newVersion: string, batchSize: number): Instance[][] {
  const steps: Instance[][] = [];
  const current = instances.map(i => ({ ...i }));

  for (let i = 0; i < current.length; i += batchSize) {
    const end = Math.min(i + batchSize, current.length);
    for (let j = i; j < end; j++) {
      current[j] = { ...current[j], version: newVersion, healthy: true };
    }
    steps.push(current.map(inst => ({ ...inst })));
  }

  return steps;
}

export function blueGreenSwitch(
  blue: Instance[],
  green: Instance[],
  targetColor: 'blue' | 'green'
): { active: Instance[]; standby: Instance[] } {
  if (targetColor === 'blue') {
    return { active: blue, standby: green };
  }
  return { active: green, standby: blue };
}

export function canaryPromote(
  totalInstances: number,
  currentCanaryPercent: number,
  steps: number[]
): number {
  const nextStep = steps.find(s => s > currentCanaryPercent);
  if (nextStep === undefined) return 100;
  return nextStep;
}

export function shouldRollback(
  metrics: CanaryMetrics,
  thresholds: { maxErrorRate: number; maxLatency: number }
): boolean {
  return metrics.errorRate > thresholds.maxErrorRate || metrics.p99Latency > thresholds.maxLatency;
}

export function calculateDowntime(strategy: 'recreate' | 'rolling' | 'blue-green' | 'canary'): string {
  switch (strategy) {
    case 'recreate': return 'minutes';
    case 'rolling': return 'zero';
    case 'blue-green': return 'zero';
    case 'canary': return 'zero';
  }
}

export function getDeploymentProgress(instances: Instance[], targetVersion: string): number {
  if (instances.length === 0) return 100;
  const updated = instances.filter(i => i.version === targetVersion).length;
  return Math.round((updated / instances.length) * 100);
}

export function isDeploymentHealthy(instances: Instance[], minHealthyPercent: number): boolean {
  if (instances.length === 0) return true;
  const healthyCount = instances.filter(i => i.healthy).length;
  return (healthyCount / instances.length) * 100 >= minHealthyPercent;
}

export function rollback(instances: Instance[], previousVersion: string): Instance[] {
  return instances.map(i => ({ ...i, version: previousVersion, healthy: true }));
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 06 — Stratégies de Déploiement');

await test('rollingUpdate — met à jour par batch', () => {
  const instances: Instance[] = [
    { id: '1', version: 'v1', healthy: true },
    { id: '2', version: 'v1', healthy: true },
    { id: '3', version: 'v1', healthy: true },
    { id: '4', version: 'v1', healthy: true },
  ];
  const steps = rollingUpdate(instances, 'v2', 2);
  assertEqual(steps.length, 2);
  assertEqual(steps[0].filter(i => i.version === 'v2').length, 2);
  assertEqual(steps[1].filter(i => i.version === 'v2').length, 4);
});

await test('blueGreenSwitch — bascule entre blue et green', () => {
  const blue: Instance[] = [{ id: '1', version: 'v1', healthy: true }];
  const green: Instance[] = [{ id: '2', version: 'v2', healthy: true }];
  const result = blueGreenSwitch(blue, green, 'green');
  assertEqual(result.active[0].version, 'v2');
  assertEqual(result.standby[0].version, 'v1');
});

await test('canaryPromote — passe à l\'étape suivante', () => {
  const steps = [5, 25, 50, 100];
  assertEqual(canaryPromote(10, 0, steps), 5);
  assertEqual(canaryPromote(10, 5, steps), 25);
  assertEqual(canaryPromote(10, 50, steps), 100);
  assertEqual(canaryPromote(10, 100, steps), 100);
});

await test('shouldRollback — déclenche le rollback sur error rate', () => {
  const thresholds = { maxErrorRate: 1, maxLatency: 500 };
  assert(shouldRollback({ errorRate: 2.5, p99Latency: 200, successRate: 97.5 }, thresholds));
  assert(!shouldRollback({ errorRate: 0.5, p99Latency: 200, successRate: 99.5 }, thresholds));
});

await test('shouldRollback — déclenche le rollback sur latence', () => {
  const thresholds = { maxErrorRate: 1, maxLatency: 500 };
  assert(shouldRollback({ errorRate: 0.1, p99Latency: 800, successRate: 99.9 }, thresholds));
});

await test('getDeploymentProgress — calcule le pourcentage de progression', () => {
  const instances: Instance[] = [
    { id: '1', version: 'v2', healthy: true },
    { id: '2', version: 'v1', healthy: true },
    { id: '3', version: 'v2', healthy: true },
    { id: '4', version: 'v1', healthy: true },
  ];
  assertEqual(getDeploymentProgress(instances, 'v2'), 50);
});

await test('isDeploymentHealthy — vérifie la santé du déploiement', () => {
  const healthy: Instance[] = [
    { id: '1', version: 'v1', healthy: true },
    { id: '2', version: 'v1', healthy: true },
    { id: '3', version: 'v1', healthy: false },
  ];
  assert(isDeploymentHealthy(healthy, 60));
  assert(!isDeploymentHealthy(healthy, 75));
});

await test('rollback — restaure la version précédente', () => {
  const instances: Instance[] = [
    { id: '1', version: 'v2', healthy: false },
    { id: '2', version: 'v2', healthy: true },
  ];
  const rolled = rollback(instances, 'v1');
  assert(rolled.every(i => i.version === 'v1'));
  assert(rolled.every(i => i.healthy));
});

summary();
