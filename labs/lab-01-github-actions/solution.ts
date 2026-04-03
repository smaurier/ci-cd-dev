import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface Step {
  name: string;
  uses?: string;
  run?: string;
}

interface Job {
  name: string;
  runsOn: string;
  needs?: string[];
  steps: Step[];
}

interface Workflow {
  name: string;
  triggers: string[];
  jobs: Map<string, Job>;
}

// --- Implémentations ---

const VALID_TRIGGERS = [
  'push', 'pull_request', 'workflow_dispatch', 'schedule',
  'release', 'issues', 'issue_comment', 'create', 'delete',
  'fork', 'watch', 'workflow_call', 'repository_dispatch',
];

export function parseWorkflow(yaml: Record<string, any>): Workflow {
  const name = yaml.name ?? 'unnamed';
  const on = yaml.on;
  const triggers: string[] = Array.isArray(on) ? on : typeof on === 'string' ? [on] : Object.keys(on);
  const jobs = new Map<string, Job>();

  for (const [id, jobDef] of Object.entries(yaml.jobs ?? {})) {
    const j = jobDef as any;
    const steps: Step[] = (j.steps ?? []).map((s: any) => ({
      name: s.name ?? 'unnamed',
      uses: s.uses,
      run: s.run,
    }));
    jobs.set(id, {
      name: j.name ?? id,
      runsOn: j['runs-on'] ?? 'ubuntu-latest',
      needs: j.needs ? (Array.isArray(j.needs) ? j.needs : [j.needs]) : undefined,
      steps,
    });
  }

  return { name, triggers, jobs };
}

export function validateTriggers(triggers: string[]): { valid: boolean; invalid: string[] } {
  const invalid = triggers.filter(t => !VALID_TRIGGERS.includes(t));
  return { valid: invalid.length === 0, invalid };
}

export function getJobOrder(jobs: Map<string, Job>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const job = jobs.get(id);
    if (job?.needs) {
      for (const dep of job.needs) {
        visit(dep);
      }
    }
    order.push(id);
  }

  for (const id of jobs.keys()) {
    visit(id);
  }
  return order;
}

export function validateWorkflow(workflow: Workflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (workflow.triggers.length === 0) {
    errors.push('No triggers defined');
  }

  if (workflow.jobs.size === 0) {
    errors.push('No jobs defined');
  }

  for (const [id, job] of workflow.jobs) {
    if (job.steps.length === 0) {
      errors.push(`Job "${id}" has no steps`);
    }
    if (job.needs) {
      for (const dep of job.needs) {
        if (!workflow.jobs.has(dep)) {
          errors.push(`Job "${id}" depends on unknown job "${dep}"`);
        }
      }
    }
  }

  const triggerValidation = validateTriggers(workflow.triggers);
  for (const t of triggerValidation.invalid) {
    errors.push(`Invalid trigger: "${t}"`);
  }

  return { valid: errors.length === 0, errors };
}

export function getWorkflowSummary(workflow: Workflow): string {
  const jobCount = workflow.jobs.size;
  const stepCount = countSteps(workflow);
  return `Workflow "${workflow.name}": ${jobCount} jobs, ${stepCount} steps, triggers: [${workflow.triggers.join(', ')}]`;
}

export function estimateDuration(workflow: Workflow): number {
  // Estimate: 30s per step, sequential jobs, parallel steps within a job
  const order = getJobOrder(workflow.jobs);
  let total = 0;
  for (const id of order) {
    const job = workflow.jobs.get(id)!;
    total += job.steps.length * 30;
  }
  return total;
}

export function findActionVersions(workflow: Workflow): Map<string, string> {
  const actions = new Map<string, string>();
  for (const job of workflow.jobs.values()) {
    for (const step of job.steps) {
      if (step.uses) {
        const [name, version] = step.uses.split('@');
        actions.set(name, version ?? 'latest');
      }
    }
  }
  return actions;
}

export function countSteps(workflow: Workflow): number {
  let total = 0;
  for (const job of workflow.jobs.values()) {
    total += job.steps.length;
  }
  return total;
}

// --- Tests ---

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 01 — GitHub Actions Fondamentaux');

await test('parseWorkflow — parse un workflow simple', () => {
  const yaml = {
    name: 'CI',
    on: ['push', 'pull_request'],
    jobs: {
      build: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { name: 'Checkout', uses: 'actions/checkout@v4' },
          { name: 'Build', run: 'npm run build' },
        ],
      },
    },
  };
  const wf = parseWorkflow(yaml);
  assertEqual(wf.name, 'CI');
  assertEqual(wf.triggers.length, 2);
  assertEqual(wf.jobs.size, 1);
  assertEqual(wf.jobs.get('build')!.steps.length, 2);
});

await test('parseWorkflow — gère les triggers en objet', () => {
  const yaml = {
    name: 'Deploy',
    on: { push: { branches: ['main'] }, workflow_dispatch: {} },
    jobs: { deploy: { steps: [{ name: 'Deploy', run: 'echo deploy' }] } },
  };
  const wf = parseWorkflow(yaml);
  assert(wf.triggers.includes('push'));
  assert(wf.triggers.includes('workflow_dispatch'));
});

await test('validateTriggers — accepte les triggers valides', () => {
  const result = validateTriggers(['push', 'pull_request', 'schedule']);
  assert(result.valid);
  assertEqual(result.invalid.length, 0);
});

await test('validateTriggers — détecte les triggers invalides', () => {
  const result = validateTriggers(['push', 'invalid_trigger', 'on_fire']);
  assert(!result.valid);
  assertEqual(result.invalid.length, 2);
});

await test('getJobOrder — ordonne les jobs par dépendances', () => {
  const jobs = new Map<string, Job>();
  jobs.set('deploy', { name: 'Deploy', runsOn: 'ubuntu-latest', needs: ['test'], steps: [{ name: 's1' }] });
  jobs.set('test', { name: 'Test', runsOn: 'ubuntu-latest', needs: ['build'], steps: [{ name: 's1' }] });
  jobs.set('build', { name: 'Build', runsOn: 'ubuntu-latest', steps: [{ name: 's1' }] });
  const order = getJobOrder(jobs);
  assert(order.indexOf('build') < order.indexOf('test'));
  assert(order.indexOf('test') < order.indexOf('deploy'));
});

await test('validateWorkflow — valide un workflow correct', () => {
  const wf = parseWorkflow({
    name: 'CI',
    on: ['push'],
    jobs: {
      build: { steps: [{ name: 'Build', run: 'npm run build' }] },
    },
  });
  const result = validateWorkflow(wf);
  assert(result.valid);
  assertEqual(result.errors.length, 0);
});

await test('validateWorkflow — détecte les dépendances manquantes', () => {
  const wf: Workflow = {
    name: 'CI',
    triggers: ['push'],
    jobs: new Map([
      ['deploy', { name: 'Deploy', runsOn: 'ubuntu-latest', needs: ['nonexistent'], steps: [{ name: 'Deploy' }] }],
    ]),
  };
  const result = validateWorkflow(wf);
  assert(!result.valid);
  assert(result.errors.some(e => e.includes('nonexistent')));
});

await test('findActionVersions — extrait les versions des actions', () => {
  const wf = parseWorkflow({
    name: 'CI',
    on: 'push',
    jobs: {
      build: {
        steps: [
          { name: 'Checkout', uses: 'actions/checkout@v4' },
          { name: 'Setup Node', uses: 'actions/setup-node@v4' },
          { name: 'Build', run: 'npm run build' },
        ],
      },
    },
  });
  const versions = findActionVersions(wf);
  assertEqual(versions.get('actions/checkout'), 'v4');
  assertEqual(versions.get('actions/setup-node'), 'v4');
  assertEqual(versions.size, 2);
});

summary();
