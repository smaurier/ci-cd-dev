import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface DockerStage { name: string; baseImage: string; instructions: string[] }
interface ImageTag { tag: string; type: 'sha' | 'branch' | 'semver' | 'latest' }

// --- Implémentations ---

export function parseDockerfile(content: string): DockerStage[] {
  const stages: DockerStage[] = [];
  let current: DockerStage | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const fromMatch = trimmed.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (fromMatch) {
      if (current) stages.push(current);
      current = {
        name: fromMatch[2] ?? `stage-${stages.length}`,
        baseImage: fromMatch[1],
        instructions: [trimmed],
      };
    } else if (current) {
      current.instructions.push(trimmed);
    }
  }
  if (current) stages.push(current);
  return stages;
}

export function analyzeLayerEfficiency(instructions: string[]): { issues: string[]; score: number } {
  const issues: string[] = [];
  let score = 100;

  const runCount = instructions.filter(i => i.startsWith('RUN')).length;
  if (runCount > 5) {
    issues.push('Too many RUN instructions — consider combining with &&');
    score -= 15;
  }

  const copyBeforeRun = instructions.findIndex(i => i.startsWith('COPY'));
  const npmInstall = instructions.findIndex(i => i.includes('npm install') || i.includes('npm ci'));
  if (copyBeforeRun >= 0 && npmInstall >= 0 && copyBeforeRun < npmInstall) {
    const copyAll = instructions[copyBeforeRun];
    if (copyAll.includes('. .') || copyAll.includes('./ ./')) {
      issues.push('COPY all files before npm install — copy package*.json first for better caching');
      score -= 20;
    }
  }

  if (instructions.some(i => i.match(/^RUN\s+apt-get\s+install/) && !i.includes('--no-install-recommends'))) {
    issues.push('apt-get install without --no-install-recommends');
    score -= 10;
  }

  if (!instructions.some(i => i.match(/^USER\s/i))) {
    issues.push('No USER instruction — container runs as root');
    score -= 15;
  }

  return { issues, score: Math.max(0, score) };
}

export function generateImageTags(ref: string, sha: string, isMainBranch: boolean): ImageTag[] {
  const tags: ImageTag[] = [];

  tags.push({ tag: `sha-${sha.slice(0, 7)}`, type: 'sha' });

  const semverMatch = ref.match(/^refs\/tags\/v?(\d+\.\d+\.\d+)$/);
  if (semverMatch) {
    const version = semverMatch[1];
    tags.push({ tag: version, type: 'semver' });
    const [major, minor] = version.split('.');
    tags.push({ tag: `${major}.${minor}`, type: 'semver' });
    tags.push({ tag: major, type: 'semver' });
    tags.push({ tag: 'latest', type: 'latest' });
  } else {
    const branchMatch = ref.match(/^refs\/heads\/(.+)$/);
    if (branchMatch) {
      const branch = branchMatch[1].replace(/\//g, '-');
      tags.push({ tag: branch, type: 'branch' });
    }
    if (isMainBranch) {
      tags.push({ tag: 'latest', type: 'latest' });
    }
  }

  return tags;
}

export function isMultiStage(stages: DockerStage[]): boolean {
  return stages.length > 1;
}

export function checkBaseImageSecurity(baseImage: string): { secure: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (baseImage.includes(':latest') || !baseImage.includes(':')) {
    warnings.push('Using :latest or untagged image — pin a specific version');
  }

  if (baseImage.startsWith('ubuntu') || baseImage.startsWith('debian')) {
    if (!baseImage.includes('slim')) {
      warnings.push('Consider using a slim variant to reduce attack surface');
    }
  }

  if (baseImage === 'node' || baseImage.match(/^node:/)) {
    if (!baseImage.includes('alpine') && !baseImage.includes('slim')) {
      warnings.push('Consider node:alpine or node:slim for smaller image');
    }
  }

  return { secure: warnings.length === 0, warnings };
}

export function estimateImageSize(stages: DockerStage[]): string {
  const lastStage = stages[stages.length - 1];
  const base = lastStage.baseImage;

  if (base.includes('alpine')) return 'small (~50-100MB)';
  if (base.includes('slim')) return 'medium (~100-200MB)';
  if (base.includes('scratch')) return 'minimal (<10MB)';
  return 'large (>200MB)';
}

export function findExposedPorts(instructions: string[]): number[] {
  const ports: number[] = [];
  for (const inst of instructions) {
    const match = inst.match(/^EXPOSE\s+(.+)/i);
    if (match) {
      const nums = match[1].split(/\s+/).map(p => parseInt(p.split('/')[0])).filter(n => !isNaN(n));
      ports.push(...nums);
    }
  }
  return ports;
}

export function hasHealthcheck(instructions: string[]): boolean {
  return instructions.some(i => i.match(/^HEALTHCHECK\s/i));
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 04 — Docker dans le CI');

await test('parseDockerfile — parse un Dockerfile multi-stage', () => {
  const content = `
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
`;
  const stages = parseDockerfile(content);
  assertEqual(stages.length, 2);
  assertEqual(stages[0].name, 'builder');
  assertEqual(stages[1].name, 'runner');
  assert(stages[0].baseImage.includes('node'));
});

await test('analyzeLayerEfficiency — détecte le manque de USER', () => {
  const instructions = ['FROM node:20', 'COPY . .', 'RUN npm ci', 'CMD ["node", "index.js"]'];
  const analysis = analyzeLayerEfficiency(instructions);
  assert(analysis.issues.some(i => i.includes('root')));
  assert(analysis.score < 100);
});

await test('generateImageTags — génère les tags pour un tag semver', () => {
  const tags = generateImageTags('refs/tags/v1.2.3', 'abc1234567890', false);
  assert(tags.some(t => t.tag === '1.2.3' && t.type === 'semver'));
  assert(tags.some(t => t.tag === '1.2' && t.type === 'semver'));
  assert(tags.some(t => t.tag === '1' && t.type === 'semver'));
  assert(tags.some(t => t.tag === 'latest'));
  assert(tags.some(t => t.type === 'sha'));
});

await test('generateImageTags — génère les tags pour une branche', () => {
  const tags = generateImageTags('refs/heads/feature/cool', 'abc1234567890', false);
  assert(tags.some(t => t.tag === 'feature-cool' && t.type === 'branch'));
  assert(!tags.some(t => t.tag === 'latest'));
});

await test('checkBaseImageSecurity — avertit sur :latest', () => {
  const result = checkBaseImageSecurity('node:latest');
  assert(!result.secure);
  assert(result.warnings.some(w => w.includes('latest')));
});

await test('checkBaseImageSecurity — approuve alpine', () => {
  const result = checkBaseImageSecurity('node:20-alpine');
  assert(result.secure);
});

await test('findExposedPorts — extrait les ports', () => {
  const ports = findExposedPorts(['FROM node:20', 'EXPOSE 3000', 'EXPOSE 8080 9090']);
  assert(ports.includes(3000));
  assert(ports.includes(8080));
  assert(ports.includes(9090));
  assertEqual(ports.length, 3);
});

await test('hasHealthcheck — détecte HEALTHCHECK', () => {
  assert(hasHealthcheck(['FROM node:20', 'HEALTHCHECK CMD curl -f http://localhost:3000']));
  assert(!hasHealthcheck(['FROM node:20', 'CMD ["node", "index.js"]']));
});

summary();
