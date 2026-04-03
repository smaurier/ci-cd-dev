// Lab 09 — Infrastructure as Code
// TODO: Implémenter les fonctions ci-dessous

interface Resource { type: string; name: string; properties: Record<string, any>; dependsOn?: string[] }
type ChangeAction = 'create' | 'update' | 'delete' | 'no-change';
interface Change { resource: string; action: ChangeAction; before?: Record<string, any>; after?: Record<string, any> }

// TODO: Implémenter planChanges
export function planChanges(desired: Resource[], current: Resource[]): Change[] {
  throw new Error('TODO');
}

// TODO: Implémenter resolveOrder
export function resolveOrder(resources: Resource[]): string[] {
  throw new Error('TODO');
}

// TODO: Implémenter detectCircularDeps
export function detectCircularDeps(resources: Resource[]): boolean {
  throw new Error('TODO');
}

// TODO: Implémenter applyPlan
export function applyPlan(changes: Change[]): { applied: number; errors: string[] } {
  throw new Error('TODO');
}

// TODO: Implémenter destroyOrder
export function destroyOrder(resources: Resource[]): string[] {
  throw new Error('TODO');
}

// TODO: Implémenter formatPlan
export function formatPlan(changes: Change[]): string {
  throw new Error('TODO');
}

// TODO: Implémenter getResourceId
export function getResourceId(resource: Resource): string {
  throw new Error('TODO');
}

// TODO: Implémenter countChanges
export function countChanges(changes: Change[]): Record<ChangeAction, number> {
  throw new Error('TODO');
}
