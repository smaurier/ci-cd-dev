import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface MatrixEntry { [key: string]: string }

interface JobOutput { [key: string]: string }
interface JobResult { status: 'success' | 'failure'; outputs: JobOutput }

interface WorkflowInput { name: string; type: 'string' | 'boolean' | 'number'; required: boolean; default?: string }

// --- Implémentations ---

export function generateMatrix(dimensions: Record<string, string[]>): MatrixEntry[] {
  const keys = Object.keys(dimensions);
  if (keys.length === 0) return [{}];

  const [first, ...rest] = keys;
  const restMatrix = generateMatrix(
    Object.fromEntries(rest.map(k => [k, dimensions[k]]))
  );

  const result: MatrixEntry[] = [];
  for (const val of dimensions[first]) {
    for (const entry of restMatrix) {
      result.push({ [first]: val, ...entry });
    }
  }
  return result;
}

export function filterMatrix(matrix: MatrixEntry[], exclude: MatrixEntry[]): MatrixEntry[] {
  return matrix.filter(entry =>
    !exclude.some(ex =>
      Object.entries(ex).every(([k, v]) => entry[k] === v)
    )
  );
}

export function includeMatrix(matrix: MatrixEntry[], include: MatrixEntry[]): MatrixEntry[] {
  return [...matrix, ...include];
}

export function resolveJobOutputs(results: Map<string, JobResult>, expression: string): string {
  // Expression format: "needs.<job>.outputs.<key>"
  const match = expression.match(/^needs\.(\w+)\.outputs\.(\w+)$/);
  if (!match) return '';
  const [, jobId, key] = match;
  const result = results.get(jobId);
  if (!result) return '';
  return result.outputs[key] ?? '';
}

export function validateWorkflowInputs(
  inputs: WorkflowInput[],
  provided: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const input of inputs) {
    const value = provided[input.name];
    if (value === undefined || value === null) {
      if (input.required && input.default === undefined) {
        errors.push(`Missing required input: "${input.name}"`);
      }
      continue;
    }

    if (input.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Input "${input.name}" must be boolean`);
    }
    if (input.type === 'number' && typeof value !== 'number') {
      errors.push(`Input "${input.name}" must be number`);
    }
    if (input.type === 'string' && typeof value !== 'string') {
      errors.push(`Input "${input.name}" must be string`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function calculateConcurrency(
  runningWorkflows: string[],
  newWorkflow: string,
  cancelInProgress: boolean
): { run: boolean; cancel: string[] } {
  const conflicts = runningWorkflows.filter(w => w === newWorkflow);
  if (conflicts.length === 0) return { run: true, cancel: [] };

  if (cancelInProgress) {
    return { run: true, cancel: conflicts };
  }
  return { run: false, cancel: [] };
}

export function getCacheKey(
  prefix: string,
  lockfileHash: string,
  restoreKeys: string[]
): { primaryKey: string; restoreKeys: string[] } {
  return {
    primaryKey: `${prefix}-${lockfileHash}`,
    restoreKeys: restoreKeys.map(k => `${prefix}-${k}`),
  };
}

export function matrixJobCount(dimensions: Record<string, string[]>, exclude: MatrixEntry[]): number {
  const matrix = generateMatrix(dimensions);
  return filterMatrix(matrix, exclude).length;
}

// --- Tests ---

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 02 — GitHub Actions Avancé');

await test('generateMatrix — produit le produit cartésien', () => {
  const matrix = generateMatrix({ os: ['ubuntu', 'windows'], node: ['18', '20'] });
  assertEqual(matrix.length, 4);
  assert(matrix.some(e => e.os === 'ubuntu' && e.node === '18'));
  assert(matrix.some(e => e.os === 'windows' && e.node === '20'));
});

await test('filterMatrix — exclut les combinaisons', () => {
  const matrix = generateMatrix({ os: ['ubuntu', 'windows'], node: ['18', '20'] });
  const filtered = filterMatrix(matrix, [{ os: 'windows', node: '18' }]);
  assertEqual(filtered.length, 3);
  assert(!filtered.some(e => e.os === 'windows' && e.node === '18'));
});

await test('resolveJobOutputs — résout les expressions needs', () => {
  const results = new Map<string, JobResult>();
  results.set('build', { status: 'success', outputs: { artifact_url: 'https://example.com/build.zip' } });
  const value = resolveJobOutputs(results, 'needs.build.outputs.artifact_url');
  assertEqual(value, 'https://example.com/build.zip');
});

await test('resolveJobOutputs — retourne vide pour job inconnu', () => {
  const results = new Map<string, JobResult>();
  const value = resolveJobOutputs(results, 'needs.unknown.outputs.foo');
  assertEqual(value, '');
});

await test('validateWorkflowInputs — valide les inputs corrects', () => {
  const inputs: WorkflowInput[] = [
    { name: 'environment', type: 'string', required: true },
    { name: 'dry_run', type: 'boolean', required: false, default: 'false' },
  ];
  const result = validateWorkflowInputs(inputs, { environment: 'production' });
  assert(result.valid);
});

await test('validateWorkflowInputs — détecte les inputs manquants', () => {
  const inputs: WorkflowInput[] = [
    { name: 'environment', type: 'string', required: true },
  ];
  const result = validateWorkflowInputs(inputs, {});
  assert(!result.valid);
  assert(result.errors.some(e => e.includes('environment')));
});

await test('calculateConcurrency — cancel-in-progress annule les anciens', () => {
  const result = calculateConcurrency(['deploy-main', 'deploy-main'], 'deploy-main', true);
  assert(result.run);
  assertEqual(result.cancel.length, 2);
});

await test('matrixJobCount — calcule le nombre de jobs après exclusions', () => {
  const count = matrixJobCount(
    { os: ['ubuntu', 'windows', 'macos'], node: ['18', '20', '22'] },
    [{ os: 'windows', node: '18' }, { os: 'macos', node: '18' }]
  );
  assertEqual(count, 7);
});

summary();
