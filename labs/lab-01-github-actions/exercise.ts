// Lab 01 — GitHub Actions Fondamentaux
// TODO: Implémenter les fonctions ci-dessous

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

// TODO: Implémenter parseWorkflow
export function parseWorkflow(yaml: Record<string, any>): Workflow {
  throw new Error('TODO');
}

// TODO: Implémenter validateTriggers
export function validateTriggers(triggers: string[]): { valid: boolean; invalid: string[] } {
  throw new Error('TODO');
}

// TODO: Implémenter getJobOrder
export function getJobOrder(jobs: Map<string, Job>): string[] {
  throw new Error('TODO');
}

// TODO: Implémenter validateWorkflow
export function validateWorkflow(workflow: Workflow): { valid: boolean; errors: string[] } {
  throw new Error('TODO');
}

// TODO: Implémenter getWorkflowSummary
export function getWorkflowSummary(workflow: Workflow): string {
  throw new Error('TODO');
}

// TODO: Implémenter estimateDuration
export function estimateDuration(workflow: Workflow): number {
  throw new Error('TODO');
}

// TODO: Implémenter findActionVersions
export function findActionVersions(workflow: Workflow): Map<string, string> {
  throw new Error('TODO');
}

// TODO: Implémenter countSteps
export function countSteps(workflow: Workflow): number {
  throw new Error('TODO');
}
