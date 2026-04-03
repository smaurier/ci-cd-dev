import { createTestRunner } from '../test-utils.js';

// --- Interfaces ---

interface TestFile { path: string; estimatedDuration: number }
interface TestResult { name: string; passed: boolean; duration: number; retries: number }
interface CoverageReport { file: string; lines: number; covered: number }

// --- Implémentations ---

export function shardTests(files: TestFile[], shardCount: number): TestFile[][] {
  const shards: TestFile[][] = Array.from({ length: shardCount }, () => []);
  const shardDurations = new Array(shardCount).fill(0);

  // Sort by duration desc, then greedily assign to least-loaded shard
  const sorted = [...files].sort((a, b) => b.estimatedDuration - a.estimatedDuration);

  for (const file of sorted) {
    let minIdx = 0;
    for (let i = 1; i < shardCount; i++) {
      if (shardDurations[i] < shardDurations[minIdx]) minIdx = i;
    }
    shards[minIdx].push(file);
    shardDurations[minIdx] += file.estimatedDuration;
  }

  return shards;
}

export function checkCoverageGate(
  reports: CoverageReport[],
  threshold: number
): { passed: boolean; coverage: number; failing: string[] } {
  let totalLines = 0;
  let totalCovered = 0;
  const failing: string[] = [];

  for (const r of reports) {
    totalLines += r.lines;
    totalCovered += r.covered;
    const fileCoverage = r.lines > 0 ? (r.covered / r.lines) * 100 : 100;
    if (fileCoverage < threshold) {
      failing.push(r.file);
    }
  }

  const coverage = totalLines > 0 ? (totalCovered / totalLines) * 100 : 100;
  return { passed: failing.length === 0, coverage: Math.round(coverage * 100) / 100, failing };
}

export function detectFlakyTests(history: TestResult[][]): string[] {
  const testStatus = new Map<string, Set<string>>();

  for (const run of history) {
    for (const result of run) {
      if (!testStatus.has(result.name)) testStatus.set(result.name, new Set());
      testStatus.get(result.name)!.add(result.passed ? 'pass' : 'fail');
    }
  }

  const flaky: string[] = [];
  for (const [name, statuses] of testStatus) {
    if (statuses.size > 1) flaky.push(name);
  }
  return flaky;
}

export function aggregateResults(
  shardResults: TestResult[][]
): { total: number; passed: number; failed: number; duration: number } {
  let total = 0, passed = 0, failed = 0, duration = 0;

  for (const shard of shardResults) {
    for (const result of shard) {
      total++;
      if (result.passed) passed++;
      else failed++;
      duration += result.duration;
    }
  }

  return { total, passed, failed, duration };
}

export function shouldRetry(result: TestResult, maxRetries: number): boolean {
  return !result.passed && result.retries < maxRetries;
}

export function generateReport(results: TestResult[]): string {
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const total = results.reduce((sum, r) => sum + r.duration, 0);
  return `Tests: ${passed} passed, ${failed} failed (${total}ms)`;
}

export function calculateShardBalance(shards: TestFile[][]): number {
  const durations = shards.map(s => s.reduce((sum, f) => sum + f.estimatedDuration, 0));
  const max = Math.max(...durations);
  const min = Math.min(...durations);
  if (max === 0) return 100;
  return Math.round(((max - min) / max) * 100);
}

export function filterByDuration(results: TestResult[], maxMs: number): TestResult[] {
  return results.filter(r => r.duration <= maxMs);
}

// --- Tests ---

const { test, assert, assertEqual, summary } = createTestRunner('Lab 03 — Testing dans le CI');

await test('shardTests — distribue équitablement les tests', () => {
  const files: TestFile[] = [
    { path: 'a.test.ts', estimatedDuration: 100 },
    { path: 'b.test.ts', estimatedDuration: 200 },
    { path: 'c.test.ts', estimatedDuration: 150 },
    { path: 'd.test.ts', estimatedDuration: 50 },
  ];
  const shards = shardTests(files, 2);
  assertEqual(shards.length, 2);
  const total = shards.flat().length;
  assertEqual(total, 4);
});

await test('checkCoverageGate — passe quand couverture suffisante', () => {
  const reports: CoverageReport[] = [
    { file: 'a.ts', lines: 100, covered: 85 },
    { file: 'b.ts', lines: 50, covered: 45 },
  ];
  const result = checkCoverageGate(reports, 80);
  assert(result.passed);
  assert(result.coverage >= 80);
});

await test('checkCoverageGate — échoue quand fichier sous le seuil', () => {
  const reports: CoverageReport[] = [
    { file: 'a.ts', lines: 100, covered: 90 },
    { file: 'b.ts', lines: 100, covered: 50 },
  ];
  const result = checkCoverageGate(reports, 80);
  assert(!result.passed);
  assert(result.failing.includes('b.ts'));
});

await test('detectFlakyTests — identifie les tests instables', () => {
  const history: TestResult[][] = [
    [{ name: 'test-A', passed: true, duration: 10, retries: 0 }, { name: 'test-B', passed: true, duration: 20, retries: 0 }],
    [{ name: 'test-A', passed: false, duration: 10, retries: 0 }, { name: 'test-B', passed: true, duration: 20, retries: 0 }],
  ];
  const flaky = detectFlakyTests(history);
  assert(flaky.includes('test-A'));
  assert(!flaky.includes('test-B'));
});

await test('aggregateResults — agrège les résultats de shards', () => {
  const shardResults: TestResult[][] = [
    [{ name: 'a', passed: true, duration: 100, retries: 0 }],
    [{ name: 'b', passed: false, duration: 200, retries: 1 }, { name: 'c', passed: true, duration: 50, retries: 0 }],
  ];
  const result = aggregateResults(shardResults);
  assertEqual(result.total, 3);
  assertEqual(result.passed, 2);
  assertEqual(result.failed, 1);
  assertEqual(result.duration, 350);
});

await test('shouldRetry — retente si retries < max', () => {
  assert(shouldRetry({ name: 'test', passed: false, duration: 10, retries: 0 }, 3));
  assert(shouldRetry({ name: 'test', passed: false, duration: 10, retries: 2 }, 3));
  assert(!shouldRetry({ name: 'test', passed: false, duration: 10, retries: 3 }, 3));
  assert(!shouldRetry({ name: 'test', passed: true, duration: 10, retries: 0 }, 3));
});

await test('generateReport — génère un rapport textuel', () => {
  const results: TestResult[] = [
    { name: 'a', passed: true, duration: 100, retries: 0 },
    { name: 'b', passed: false, duration: 200, retries: 1 },
  ];
  const report = generateReport(results);
  assert(report.includes('1 passed'));
  assert(report.includes('1 failed'));
  assert(report.includes('300ms'));
});

await test('calculateShardBalance — mesure le déséquilibre', () => {
  const balanced: TestFile[][] = [
    [{ path: 'a.ts', estimatedDuration: 100 }],
    [{ path: 'b.ts', estimatedDuration: 100 }],
  ];
  assertEqual(calculateShardBalance(balanced), 0);

  const unbalanced: TestFile[][] = [
    [{ path: 'a.ts', estimatedDuration: 200 }],
    [{ path: 'b.ts', estimatedDuration: 100 }],
  ];
  assertEqual(calculateShardBalance(unbalanced), 50);
});

summary();
