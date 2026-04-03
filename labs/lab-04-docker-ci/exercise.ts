// Lab 04 — Docker dans le CI
// TODO: Implémenter les fonctions ci-dessous

interface DockerStage { name: string; baseImage: string; instructions: string[] }
interface ImageTag { tag: string; type: 'sha' | 'branch' | 'semver' | 'latest' }

// TODO: Implémenter parseDockerfile
export function parseDockerfile(content: string): DockerStage[] {
  throw new Error('TODO');
}

// TODO: Implémenter analyzeLayerEfficiency
export function analyzeLayerEfficiency(instructions: string[]): { issues: string[]; score: number } {
  throw new Error('TODO');
}

// TODO: Implémenter generateImageTags
export function generateImageTags(ref: string, sha: string, isMainBranch: boolean): ImageTag[] {
  throw new Error('TODO');
}

// TODO: Implémenter isMultiStage
export function isMultiStage(stages: DockerStage[]): boolean {
  throw new Error('TODO');
}

// TODO: Implémenter checkBaseImageSecurity
export function checkBaseImageSecurity(baseImage: string): { secure: boolean; warnings: string[] } {
  throw new Error('TODO');
}

// TODO: Implémenter estimateImageSize
export function estimateImageSize(stages: DockerStage[]): string {
  throw new Error('TODO');
}

// TODO: Implémenter findExposedPorts
export function findExposedPorts(instructions: string[]): number[] {
  throw new Error('TODO');
}

// TODO: Implémenter hasHealthcheck
export function hasHealthcheck(instructions: string[]): boolean {
  throw new Error('TODO');
}
