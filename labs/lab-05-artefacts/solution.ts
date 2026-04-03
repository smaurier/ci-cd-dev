import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface SemVer { major: number; minor: number; patch: number; prerelease?: string }
interface Artifact { name: string; version: string; size: number; createdAt: Date }
interface ConventionalCommit { type: string; scope?: string; description: string; breaking: boolean }

// --- Implémentations ---

export function parseSemVer(version: string): SemVer {
  const cleaned = version.startsWith('v') ? version.slice(1) : version;
  const [main, prerelease] = cleaned.split('-', 2);
  const [major, minor, patch] = main.split('.').map(Number);
  return { major, minor, patch, prerelease };
}

export function bumpVersion(current: SemVer, type: 'major' | 'minor' | 'patch'): SemVer {
  switch (type) {
    case 'major': return { major: current.major + 1, minor: 0, patch: 0 };
    case 'minor': return { major: current.major, minor: current.minor + 1, patch: 0 };
    case 'patch': return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function parseConventionalCommit(message: string): ConventionalCommit | null {
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return {
    type,
    scope: scope || undefined,
    description,
    breaking: bang === '!' || message.includes('BREAKING CHANGE'),
  };
}

export function determineNextVersion(current: SemVer, commits: ConventionalCommit[]): SemVer {
  let hasBreaking = false;
  let hasFeature = false;

  for (const commit of commits) {
    if (commit.breaking) hasBreaking = true;
    if (commit.type === 'feat') hasFeature = true;
  }

  if (hasBreaking) return bumpVersion(current, 'major');
  if (hasFeature) return bumpVersion(current, 'minor');
  return bumpVersion(current, 'patch');
}

export function generateChangelog(version: string, commits: ConventionalCommit[]): string {
  const lines: string[] = [`# ${version}`];

  const features = commits.filter(c => c.type === 'feat');
  const fixes = commits.filter(c => c.type === 'fix');
  const breaking = commits.filter(c => c.breaking);

  if (breaking.length > 0) {
    lines.push('', '## Breaking Changes');
    for (const c of breaking) lines.push(`- ${c.description}`);
  }
  if (features.length > 0) {
    lines.push('', '## Features');
    for (const c of features) lines.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description}`);
  }
  if (fixes.length > 0) {
    lines.push('', '## Bug Fixes');
    for (const c of fixes) lines.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description}`);
  }

  return lines.join('\n');
}

export function filterExpiredArtifacts(artifacts: Artifact[], retentionDays: number): Artifact[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return artifacts.filter(a => a.createdAt < cutoff);
}

export function formatVersion(version: SemVer): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${base}-${version.prerelease}` : base;
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 05 — Artefacts et Registries');

await test('parseSemVer — parse une version sémantique', () => {
  const v = parseSemVer('1.2.3');
  assertEqual(v.major, 1);
  assertEqual(v.minor, 2);
  assertEqual(v.patch, 3);

  const v2 = parseSemVer('v2.0.0-beta');
  assertEqual(v2.major, 2);
  assertEqual(v2.prerelease, 'beta');
});

await test('bumpVersion — incrémente la version correctement', () => {
  const v = { major: 1, minor: 2, patch: 3 };
  const major = bumpVersion(v, 'major');
  assertEqual(major.major, 2);
  assertEqual(major.minor, 0);
  assertEqual(major.patch, 0);

  const minor = bumpVersion(v, 'minor');
  assertEqual(minor.minor, 3);
  assertEqual(minor.patch, 0);
});

await test('compareSemVer — compare deux versions', () => {
  assert(compareSemVer({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 }) > 0);
  assert(compareSemVer({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 1 }) < 0);
  assertEqual(compareSemVer({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 }), 0);
});

await test('parseConventionalCommit — parse un commit conventionnel', () => {
  const c1 = parseConventionalCommit('feat(auth): add JWT support');
  assert(c1 !== null);
  assertEqual(c1!.type, 'feat');
  assertEqual(c1!.scope, 'auth');
  assertEqual(c1!.description, 'add JWT support');
  assert(!c1!.breaking);

  const c2 = parseConventionalCommit('fix!: critical security patch');
  assert(c2 !== null);
  assert(c2!.breaking);
});

await test('determineNextVersion — détermine la bonne version', () => {
  const current = { major: 1, minor: 2, patch: 3 };
  const breaking: ConventionalCommit[] = [{ type: 'feat', description: 'new api', breaking: true }];
  assertEqual(determineNextVersion(current, breaking).major, 2);

  const feature: ConventionalCommit[] = [{ type: 'feat', description: 'new feature', breaking: false }];
  assertEqual(determineNextVersion(current, feature).minor, 3);

  const fix: ConventionalCommit[] = [{ type: 'fix', description: 'bugfix', breaking: false }];
  assertEqual(determineNextVersion(current, fix).patch, 4);
});

await test('generateChangelog — génère un changelog structuré', () => {
  const commits: ConventionalCommit[] = [
    { type: 'feat', scope: 'auth', description: 'add OAuth', breaking: false },
    { type: 'fix', description: 'fix memory leak', breaking: false },
  ];
  const changelog = generateChangelog('2.0.0', commits);
  assert(changelog.includes('# 2.0.0'));
  assert(changelog.includes('## Features'));
  assert(changelog.includes('**auth:**'));
  assert(changelog.includes('## Bug Fixes'));
});

await test('filterExpiredArtifacts — filtre les artefacts expirés', () => {
  const now = new Date();
  const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
  const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const artifacts: Artifact[] = [
    { name: 'old-build', version: '1.0.0', size: 100, createdAt: old },
    { name: 'recent-build', version: '2.0.0', size: 200, createdAt: recent },
  ];
  const expired = filterExpiredArtifacts(artifacts, 30);
  assertEqual(expired.length, 1);
  assertEqual(expired[0].name, 'old-build');
});

await test('formatVersion — formate avec et sans prerelease', () => {
  assertEqual(formatVersion({ major: 1, minor: 2, patch: 3 }), '1.2.3');
  assertEqual(formatVersion({ major: 2, minor: 0, patch: 0, prerelease: 'rc.1' }), '2.0.0-rc.1');
});

summary();
