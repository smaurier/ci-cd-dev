import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface Resource { type: string; name: string; properties: Record<string, any>; dependsOn?: string[] }
type ChangeAction = 'create' | 'update' | 'delete' | 'no-change';
interface Change { resource: string; action: ChangeAction; before?: Record<string, any>; after?: Record<string, any> }

// --- Implémentations ---

export function getResourceId(resource: Resource): string {
  return `${resource.type}.${resource.name}`;
}

export function planChanges(desired: Resource[], current: Resource[]): Change[] {
  const changes: Change[] = [];
  const currentMap = new Map(current.map(r => [getResourceId(r), r]));
  const desiredMap = new Map(desired.map(r => [getResourceId(r), r]));

  for (const [id, res] of desiredMap) {
    const existing = currentMap.get(id);
    if (!existing) {
      changes.push({ resource: id, action: 'create', after: res.properties });
    } else if (JSON.stringify(existing.properties) !== JSON.stringify(res.properties)) {
      changes.push({ resource: id, action: 'update', before: existing.properties, after: res.properties });
    } else {
      changes.push({ resource: id, action: 'no-change' });
    }
  }

  for (const [id, res] of currentMap) {
    if (!desiredMap.has(id)) {
      changes.push({ resource: id, action: 'delete', before: res.properties });
    }
  }

  return changes;
}

export function resolveOrder(resources: Resource[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const resMap = new Map(resources.map(r => [getResourceId(r), r]));

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // Circular — skip to avoid infinite loop
    visiting.add(id);
    const res = resMap.get(id);
    if (res?.dependsOn) {
      for (const dep of res.dependsOn) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const id of resMap.keys()) {
    visit(id);
  }
  return order;
}

export function detectCircularDeps(resources: Resource[]): boolean {
  const resMap = new Map(resources.map(r => [getResourceId(r), r]));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const res = resMap.get(id);
    if (res?.dependsOn) {
      for (const dep of res.dependsOn) {
        if (hasCycle(dep)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of resMap.keys()) {
    if (hasCycle(id)) return true;
  }
  return false;
}

export function applyPlan(changes: Change[]): { applied: number; errors: string[] } {
  let applied = 0;
  const errors: string[] = [];

  for (const change of changes) {
    if (change.action === 'no-change') continue;
    applied++;
  }

  return { applied, errors };
}

export function destroyOrder(resources: Resource[]): string[] {
  return resolveOrder(resources).reverse();
}

export function formatPlan(changes: Change[]): string {
  const symbols: Record<ChangeAction, string> = {
    create: '+',
    update: '~',
    delete: '-',
    'no-change': ' ',
  };

  const lines = changes
    .filter(c => c.action !== 'no-change')
    .map(c => `  ${symbols[c.action]} ${c.resource}`);

  if (lines.length === 0) return 'No changes.';

  const counts = countChanges(changes);
  const summary = `Plan: ${counts.create} to create, ${counts.update} to update, ${counts.delete} to delete.`;
  return [...lines, '', summary].join('\n');
}

export function countChanges(changes: Change[]): Record<ChangeAction, number> {
  const counts: Record<ChangeAction, number> = { create: 0, update: 0, delete: 0, 'no-change': 0 };
  for (const c of changes) {
    counts[c.action]++;
  }
  return counts;
}

// --- Tests ---

const { test, assert, assertEqual, assertIncludes, summary } = createTestRunner('Lab 09 — Infrastructure as Code');

await test('planChanges — détecte les créations', () => {
  const desired: Resource[] = [{ type: 'aws_s3_bucket', name: 'frontend', properties: { bucket: 'my-app' } }];
  const changes = planChanges(desired, []);
  assertEqual(changes.length, 1);
  assertEqual(changes[0].action, 'create');
});

await test('planChanges — détecte les mises à jour', () => {
  const desired: Resource[] = [{ type: 'aws_s3_bucket', name: 'frontend', properties: { bucket: 'my-app', versioning: true } }];
  const current: Resource[] = [{ type: 'aws_s3_bucket', name: 'frontend', properties: { bucket: 'my-app' } }];
  const changes = planChanges(desired, current);
  assertEqual(changes.length, 1);
  assertEqual(changes[0].action, 'update');
});

await test('planChanges — détecte les suppressions', () => {
  const current: Resource[] = [{ type: 'aws_s3_bucket', name: 'old', properties: { bucket: 'old' } }];
  const changes = planChanges([], current);
  assertEqual(changes.length, 1);
  assertEqual(changes[0].action, 'delete');
});

await test('resolveOrder — ordonne par dépendances', () => {
  const resources: Resource[] = [
    { type: 'aws_cloudfront', name: 'cdn', properties: {}, dependsOn: ['aws_s3_bucket.frontend'] },
    { type: 'aws_s3_bucket', name: 'frontend', properties: {} },
  ];
  const order = resolveOrder(resources);
  assert(order.indexOf('aws_s3_bucket.frontend') < order.indexOf('aws_cloudfront.cdn'));
});

await test('detectCircularDeps — détecte les cycles', () => {
  const resources: Resource[] = [
    { type: 'a', name: 'one', properties: {}, dependsOn: ['b.two'] },
    { type: 'b', name: 'two', properties: {}, dependsOn: ['a.one'] },
  ];
  assert(detectCircularDeps(resources));
});

await test('detectCircularDeps — approuve un graphe valide', () => {
  const resources: Resource[] = [
    { type: 'a', name: 'one', properties: {}, dependsOn: ['b.two'] },
    { type: 'b', name: 'two', properties: {} },
  ];
  assert(!detectCircularDeps(resources));
});

await test('destroyOrder — inverse l\'ordre de création', () => {
  const resources: Resource[] = [
    { type: 'aws_cloudfront', name: 'cdn', properties: {}, dependsOn: ['aws_s3_bucket.frontend'] },
    { type: 'aws_s3_bucket', name: 'frontend', properties: {} },
  ];
  const order = destroyOrder(resources);
  assert(order.indexOf('aws_cloudfront.cdn') < order.indexOf('aws_s3_bucket.frontend'));
});

await test('formatPlan — formate le plan lisiblement', () => {
  const changes: Change[] = [
    { resource: 'aws_s3_bucket.frontend', action: 'create', after: { bucket: 'app' } },
    { resource: 'aws_iam_role.old', action: 'delete', before: { name: 'old' } },
  ];
  const plan = formatPlan(changes);
  assertIncludes(plan, '+ aws_s3_bucket.frontend');
  assertIncludes(plan, '- aws_iam_role.old');
  assertIncludes(plan, '1 to create');
  assertIncludes(plan, '1 to delete');
});

summary();
