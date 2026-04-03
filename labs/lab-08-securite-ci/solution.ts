import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface Permission { scope: string; level: 'read' | 'write' | 'none' }
interface ActionRef { action: string; ref: string }

// --- Implémentations ---

const SENSITIVE_SCOPES = ['contents', 'packages', 'deployments', 'id-token', 'actions'];

export function auditPermissions(permissions: Permission[]): { secure: boolean; warnings: string[] } {
  const warnings: string[] = [];

  const writePerms = permissions.filter(p => p.level === 'write');
  for (const p of writePerms) {
    if (SENSITIVE_SCOPES.includes(p.scope)) {
      warnings.push(`Write permission on sensitive scope: "${p.scope}"`);
    }
  }

  if (permissions.length === 0) {
    warnings.push('No explicit permissions — defaults to broad access');
  }

  return { secure: warnings.length === 0, warnings };
}

export function detectScriptInjection(runCommand: string): { vulnerable: boolean; patterns: string[] } {
  const dangerousPatterns = [
    /\$\{\{\s*github\.event\.\w+\.title\s*\}\}/,
    /\$\{\{\s*github\.event\.\w+\.body\s*\}\}/,
    /\$\{\{\s*github\.event\.comment\.body\s*\}\}/,
    /\$\{\{\s*github\.head_ref\s*\}\}/,
    /\$\{\{\s*github\.event\.inputs\.\w+\s*\}\}/,
  ];

  const patterns: string[] = [];
  for (const pattern of dangerousPatterns) {
    const match = runCommand.match(pattern);
    if (match) {
      patterns.push(match[0]);
    }
  }

  return { vulnerable: patterns.length > 0, patterns };
}

export function validateActionPinning(actions: ActionRef[]): { pinned: ActionRef[]; unpinned: ActionRef[] } {
  const pinned: ActionRef[] = [];
  const unpinned: ActionRef[] = [];

  for (const action of actions) {
    // A SHA pin is a 40-char hex hash
    if (/^[a-f0-9]{40}$/.test(action.ref)) {
      pinned.push(action);
    } else {
      unpinned.push(action);
    }
  }

  return { pinned, unpinned };
}

export function checkSecretUsage(steps: string[]): { exposed: string[]; safe: boolean } {
  const exposed: string[] = [];

  for (const step of steps) {
    // Check for echo + secret pattern
    if (step.match(/echo\s+.*\$\{\{\s*secrets\.\w+\s*\}\}/)) {
      const secretMatch = step.match(/secrets\.(\w+)/);
      if (secretMatch) exposed.push(secretMatch[1]);
    }
    // Check for direct logging of secrets
    if (step.match(/console\.log.*\$\{\{\s*secrets\.\w+\s*\}\}/)) {
      const secretMatch = step.match(/secrets\.(\w+)/);
      if (secretMatch) exposed.push(secretMatch[1]);
    }
  }

  return { exposed, safe: exposed.length === 0 };
}

export function generateSecurityReport(issues: string[]): string {
  if (issues.length === 0) return 'Security Audit: PASSED — No issues found.';
  const lines = ['Security Audit: FAILED', '', `Found ${issues.length} issue(s):`, ''];
  for (const issue of issues) {
    lines.push(`  - ${issue}`);
  }
  return lines.join('\n');
}

export function isOidcConfigured(permissions: Permission[]): boolean {
  return permissions.some(p => p.scope === 'id-token' && (p.level === 'write'));
}

export function calculateSecurityScore(checks: { name: string; passed: boolean; weight: number }[]): number {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 100;
  const passedWeight = checks.filter(c => c.passed).reduce((sum, c) => sum + c.weight, 0);
  return Math.round((passedWeight / totalWeight) * 100);
}

export function suggestFixes(issues: string[]): Map<string, string> {
  const fixes = new Map<string, string>();
  for (const issue of issues) {
    if (issue.includes('permission')) {
      fixes.set(issue, 'Use explicit minimal permissions in the workflow');
    } else if (issue.includes('injection')) {
      fixes.set(issue, 'Pass untrusted data via environment variables instead of inline expressions');
    } else if (issue.includes('pinning') || issue.includes('unpinned')) {
      fixes.set(issue, 'Pin actions to full SHA commit hashes');
    } else if (issue.includes('secret')) {
      fixes.set(issue, 'Never echo or log secrets directly');
    } else {
      fixes.set(issue, 'Review and apply security best practices');
    }
  }
  return fixes;
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 08 — Sécurité des Pipelines CI');

await test('auditPermissions — détecte les permissions write sensibles', () => {
  const perms: Permission[] = [
    { scope: 'contents', level: 'write' },
    { scope: 'pull-requests', level: 'read' },
  ];
  const result = auditPermissions(perms);
  assert(!result.secure);
  assert(result.warnings.some(w => w.includes('contents')));
});

await test('auditPermissions — approuve les permissions minimales', () => {
  const perms: Permission[] = [
    { scope: 'contents', level: 'read' },
    { scope: 'pull-requests', level: 'read' },
  ];
  const result = auditPermissions(perms);
  assert(result.secure);
});

await test('detectScriptInjection — détecte les expressions dangereuses', () => {
  const result = detectScriptInjection('echo "${{ github.event.pull_request.title }}"');
  assert(result.vulnerable);
  assert(result.patterns.length > 0);
});

await test('detectScriptInjection — approuve les commandes safe', () => {
  const result = detectScriptInjection('echo "$PR_TITLE"');
  assert(!result.vulnerable);
});

await test('validateActionPinning — distingue SHA et tag', () => {
  const actions: ActionRef[] = [
    { action: 'actions/checkout', ref: 'b4ffde65f46336ab88eb53be808477a3936bae11' },
    { action: 'actions/setup-node', ref: 'v4' },
  ];
  const result = validateActionPinning(actions);
  assertEqual(result.pinned.length, 1);
  assertEqual(result.unpinned.length, 1);
  assertEqual(result.pinned[0].action, 'actions/checkout');
});

await test('checkSecretUsage — détecte les secrets exposés', () => {
  const steps = [
    'echo ${{ secrets.API_KEY }}',
    'npm run build',
  ];
  const result = checkSecretUsage(steps);
  assert(!result.safe);
  assert(result.exposed.includes('API_KEY'));
});

await test('calculateSecurityScore — calcule le score pondéré', () => {
  const checks = [
    { name: 'permissions', passed: true, weight: 30 },
    { name: 'pinning', passed: false, weight: 20 },
    { name: 'secrets', passed: true, weight: 50 },
  ];
  assertEqual(calculateSecurityScore(checks), 80);
});

await test('isOidcConfigured — détecte la configuration OIDC', () => {
  assert(isOidcConfigured([{ scope: 'id-token', level: 'write' }]));
  assert(!isOidcConfigured([{ scope: 'contents', level: 'read' }]));
});

summary();
