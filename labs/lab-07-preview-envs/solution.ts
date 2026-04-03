import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface PreviewEnv {
  prNumber: number;
  url: string;
  branch: string;
  status: 'deploying' | 'active' | 'destroying';
  createdAt: Date;
  lastActivity: Date;
}

// --- Implémentations ---

export function generatePreviewUrl(baseDomain: string, prNumber: number): string {
  return `https://pr-${prNumber}.${baseDomain}`;
}

export function createPreviewEnv(prNumber: number, branch: string, baseDomain: string): PreviewEnv {
  const now = new Date();
  return {
    prNumber,
    url: generatePreviewUrl(baseDomain, prNumber),
    branch,
    status: 'deploying',
    createdAt: now,
    lastActivity: now,
  };
}

export function findStaleEnvironments(envs: PreviewEnv[], maxInactiveDays: number): PreviewEnv[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxInactiveDays);
  return envs.filter(e => e.lastActivity < cutoff && e.status === 'active');
}

export function generateDbName(prefix: string, prNumber: number): string {
  return `${prefix}_pr_${prNumber}`;
}

export function getEnvResources(env: PreviewEnv): string[] {
  return [
    `container:preview-${env.prNumber}`,
    `db:${generateDbName('app', env.prNumber)}`,
    `dns:pr-${env.prNumber}`,
    `ssl:pr-${env.prNumber}`,
  ];
}

export function estimateEnvCost(activeEnvs: number, hourlyRate: number, hoursActive: number): number {
  return Math.round(activeEnvs * hourlyRate * hoursActive * 100) / 100;
}

export function shouldAutoDestroy(env: PreviewEnv, prMerged: boolean, maxAgeDays: number): boolean {
  if (prMerged) return true;
  const ageDays = (Date.now() - env.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

export function generateComment(env: PreviewEnv): string {
  return [
    `### Preview Environment`,
    `| Property | Value |`,
    `|---|---|`,
    `| **URL** | ${env.url} |`,
    `| **Branch** | \`${env.branch}\` |`,
    `| **Status** | ${env.status} |`,
  ].join('\n');
}

// --- Tests ---

const { test, assert, assertEqual, assertIncludes, summary } = createTestRunner('Lab 07 — Preview Environments');

await test('generatePreviewUrl — génère l\'URL de preview', () => {
  assertEqual(generatePreviewUrl('preview.myapp.com', 42), 'https://pr-42.preview.myapp.com');
  assertEqual(generatePreviewUrl('dev.example.com', 7), 'https://pr-7.dev.example.com');
});

await test('createPreviewEnv — crée un environnement', () => {
  const env = createPreviewEnv(42, 'feature/auth', 'preview.app.com');
  assertEqual(env.prNumber, 42);
  assertEqual(env.branch, 'feature/auth');
  assertEqual(env.status, 'deploying');
  assertIncludes(env.url, 'pr-42');
});

await test('findStaleEnvironments — trouve les envs inactifs', () => {
  const old = new Date();
  old.setDate(old.getDate() - 10);
  const recent = new Date();

  const envs: PreviewEnv[] = [
    { prNumber: 1, url: '', branch: 'a', status: 'active', createdAt: old, lastActivity: old },
    { prNumber: 2, url: '', branch: 'b', status: 'active', createdAt: recent, lastActivity: recent },
    { prNumber: 3, url: '', branch: 'c', status: 'destroying', createdAt: old, lastActivity: old },
  ];

  const stale = findStaleEnvironments(envs, 7);
  assertEqual(stale.length, 1);
  assertEqual(stale[0].prNumber, 1);
});

await test('generateDbName — génère un nom de DB sanitisé', () => {
  assertEqual(generateDbName('myapp', 42), 'myapp_pr_42');
  assertEqual(generateDbName('staging', 100), 'staging_pr_100');
});

await test('getEnvResources — liste les ressources d\'un env', () => {
  const env = createPreviewEnv(42, 'feat', 'app.com');
  const resources = getEnvResources(env);
  assert(resources.length >= 3);
  assert(resources.some(r => r.includes('container')));
  assert(resources.some(r => r.includes('db')));
});

await test('estimateEnvCost — calcule le coût estimé', () => {
  const cost = estimateEnvCost(5, 0.10, 24);
  assertEqual(cost, 12);
});

await test('shouldAutoDestroy — détruit si PR mergée', () => {
  const env = createPreviewEnv(1, 'feat', 'app.com');
  assert(shouldAutoDestroy(env, true, 7));
  assert(!shouldAutoDestroy(env, false, 7));
});

await test('generateComment — génère un commentaire markdown', () => {
  const env = createPreviewEnv(42, 'feature/auth', 'preview.app.com');
  const comment = generateComment(env);
  assertIncludes(comment, 'Preview Environment');
  assertIncludes(comment, env.url);
  assertIncludes(comment, 'deploying');
});

summary();
