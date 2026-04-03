// Lab 05 — Artefacts et Registries
// TODO: Implémenter les fonctions ci-dessous

interface SemVer { major: number; minor: number; patch: number; prerelease?: string }
interface Artifact { name: string; version: string; size: number; createdAt: Date }
interface ConventionalCommit { type: string; scope?: string; description: string; breaking: boolean }

// TODO: Implémenter parseSemVer
export function parseSemVer(version: string): SemVer {
  throw new Error('TODO');
}

// TODO: Implémenter bumpVersion
export function bumpVersion(current: SemVer, type: 'major' | 'minor' | 'patch'): SemVer {
  throw new Error('TODO');
}

// TODO: Implémenter compareSemVer
export function compareSemVer(a: SemVer, b: SemVer): number {
  throw new Error('TODO');
}

// TODO: Implémenter parseConventionalCommit
export function parseConventionalCommit(message: string): ConventionalCommit | null {
  throw new Error('TODO');
}

// TODO: Implémenter determineNextVersion
export function determineNextVersion(current: SemVer, commits: ConventionalCommit[]): SemVer {
  throw new Error('TODO');
}

// TODO: Implémenter generateChangelog
export function generateChangelog(version: string, commits: ConventionalCommit[]): string {
  throw new Error('TODO');
}

// TODO: Implémenter filterExpiredArtifacts
export function filterExpiredArtifacts(artifacts: Artifact[], retentionDays: number): Artifact[] {
  throw new Error('TODO');
}

// TODO: Implémenter formatVersion
export function formatVersion(version: SemVer): string {
  throw new Error('TODO');
}
