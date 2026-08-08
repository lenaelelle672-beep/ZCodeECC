const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const {
  findHookGroup,
  readCanonicalHooks,
  resolveAgentDataHome,
  sanitizeHookOutput,
} = require('../../scripts/zcode/hook-bridge');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Testing ZCode hook bridge ===\n');

test('finds every canonical hook group by stable event/id pair', () => {
  const hooks = readCanonicalHooks(repoRoot);
  let count = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      assert.strictEqual(findHookGroup(hooks, event, group.id), group);
      count += 1;
    }
  }
  assert.strictEqual(count, 21);
});

test('keeps ZCode hook state out of the Claude home by default', () => {
  assert.strictEqual(
    resolveAgentDataHome({ HOME: '/Users/example' }),
    path.join('/Users/example', '.zcode', 'ecc-data')
  );
  assert.strictEqual(
    resolveAgentDataHome({ HOME: '/Users/example', ECC_AGENT_DATA_HOME: '/tmp/ecc-data' }),
    '/tmp/ecc-data'
  );
});

test('executes an adapted bundled hook and returns strict ZCode JSON', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-hook-'));
  const homeDir = path.join(temporaryRoot, 'home');
  const workspace = path.join(temporaryRoot, 'workspace');
  const pluginRoot = path.join(repoRoot, 'plugins', 'zcode-ecc');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  try {
    const rawInput = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(workspace, 'TODO.md') },
    });
    const stdout = execFileSync(process.execPath, [
      path.join(pluginRoot, 'scripts', 'zcode', 'hook-bridge.js'),
      'PreToolUse',
      'pre:write:doc-file-warning',
      'PreToolUse',
    ], {
      cwd: workspace,
      env: { ...process.env, HOME: homeDir, ZCODE_PLUGIN_ROOT: pluginRoot },
      input: rawInput,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(parsed.hookSpecificOutput.additionalContext, /Ad-hoc documentation/i);
    assert.ok(!fs.existsSync(path.join(homeDir, '.claude')));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('drops passthrough event input instead of returning invalid ZCode hook JSON', () => {
  const raw = JSON.stringify({ hookEventName: 'PreToolUse', toolName: 'Read', extra: true });
  assert.strictEqual(sanitizeHookOutput(raw, 'PreToolUse', raw), '');
});

test('whitelists top-level output and rewrites mapped hook event names', () => {
  const source = JSON.stringify({
    additionalContext: 'kept',
    unexpected: 'drop me',
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: 'compaction note',
      unexpected: 'drop me too',
    },
  });
  const parsed = JSON.parse(sanitizeHookOutput(source, 'SessionStart'));
  assert.deepStrictEqual(parsed, {
    additionalContext: 'kept',
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'compaction note',
    },
  });
});

test('preserves valid ZCode PreToolUse permission decisions', () => {
  const source = JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'review required',
      updatedInput: { path: 'safe.txt' },
    },
  });
  const parsed = JSON.parse(sanitizeHookOutput(source, 'PreToolUse'));
  assert.strictEqual(parsed.continue, true);
  assert.deepStrictEqual(parsed.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'review required',
    updatedInput: { path: 'safe.txt' },
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
