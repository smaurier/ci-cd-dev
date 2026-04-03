// Lab 07 — Preview Environments
// TODO: Implémenter les fonctions ci-dessous

interface PreviewEnv { prNumber: number; url: string; branch: string; status: 'deploying' | 'active' | 'destroying'; createdAt: Date; lastActivity: Date }

// TODO: Implémenter generatePreviewUrl
export function generatePreviewUrl(baseDomain: string, prNumber: number): string {
  throw new Error('TODO');
}

// TODO: Implémenter createPreviewEnv
export function createPreviewEnv(prNumber: number, branch: string, baseDomain: string): PreviewEnv {
  throw new Error('TODO');
}

// TODO: Implémenter findStaleEnvironments
export function findStaleEnvironments(envs: PreviewEnv[], maxInactiveDays: number): PreviewEnv[] {
  throw new Error('TODO');
}

// TODO: Implémenter generateDbName
export function generateDbName(prefix: string, prNumber: number): string {
  throw new Error('TODO');
}

// TODO: Implémenter getEnvResources
export function getEnvResources(env: PreviewEnv): string[] {
  throw new Error('TODO');
}

// TODO: Implémenter estimateEnvCost
export function estimateEnvCost(activeEnvs: number, hourlyRate: number, hoursActive: number): number {
  throw new Error('TODO');
}

// TODO: Implémenter shouldAutoDestroy
export function shouldAutoDestroy(env: PreviewEnv, prMerged: boolean, maxAgeDays: number): boolean {
  throw new Error('TODO');
}

// TODO: Implémenter generateComment
export function generateComment(env: PreviewEnv): string {
  throw new Error('TODO');
}
