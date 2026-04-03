export function createTestRunner(labName: string) {
  let passed = 0;
  let failed = 0;

  console.log(`\n🔬 ${labName}\n${'='.repeat(50)}`);

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      failed++;
      console.log(`  ❌ ${name}`);
      console.log(`     ${e.message}`);
    }
  }

  function assert(condition: boolean, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
  }

  function assertEqual<T>(actual: T, expected: T, message?: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(message ?? `Expected ${b}, got ${a}`);
    }
  }

  function assertDeepEqual<T>(actual: T, expected: T, message?: string) {
    assertEqual(actual, expected, message);
  }

  function assertThrows(fn: () => void, message = 'Expected function to throw') {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error(message);
  }

  function assertIncludes(str: string, sub: string, message?: string) {
    if (!str.includes(sub)) {
      throw new Error(message ?? `Expected "${str}" to include "${sub}"`);
    }
  }

  function summary() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 Résultats: ${passed} passés, ${failed} échoués sur ${passed + failed}`);
    if (failed > 0) process.exit(1);
  }

  return { test, assert, assertEqual, assertDeepEqual, assertThrows, assertIncludes, summary };
}
