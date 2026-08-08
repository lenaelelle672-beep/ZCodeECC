const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const uninstallScript = path.join(repoRoot, 'scripts', 'uninstall.js');
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

function normalize(value) {
  return String(value || '').split(path.sep).join('/');
}

console.log('\n=== Testing ZCode install target ===\n');

test('registers ZCode in the install and harness capability catalogs', () => {
  const { SUPPORTED_INSTALL_TARGETS } = require('../../scripts/lib/install-manifests');
  const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
  const { getHarnessCapability } = require('../../scripts/lib/harness-capabilities');
  assert.ok(SUPPORTED_INSTALL_TARGETS.includes('zcode'));
  const adapter = getInstallTargetAdapter('zcode');
  assert.strictEqual(adapter.id, 'zcode-home');
  assert.strictEqual(adapter.resolveRoot({ homeDir: '/Users/example' }), path.join('/Users/example', '.zcode'));
  const capability = getHarnessCapability('zcode');
  assert.strictEqual(capability.label, 'ZCode');
  assert.strictEqual(capability.destination, '~/.zcode');
});

test('maps agents, rules, commands, and selected workflow skills to generated ZCode surfaces', () => {
  const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
  const homeDir = '/Users/example';
  const plan = resolveInstallPlan({
    moduleIds: ['rules-core', 'agents-core', 'commands-core', 'workflow-quality'],
    target: 'zcode',
    repoRoot,
    projectRoot: repoRoot,
    homeDir,
  });
  assert.strictEqual(plan.targetAdapterId, 'zcode-home');
  assert.ok(plan.operations.some(operation => normalize(operation.sourceRelativePath).startsWith('.zcode/skills/ecc-agent-')));
  assert.ok(plan.operations.some(operation => normalize(operation.sourceRelativePath).startsWith('.zcode/skills/ecc-rules-')));
  assert.ok(plan.operations.some(operation => normalize(operation.sourceRelativePath) === '.zcode/commands'));
  assert.ok(plan.operations.some(operation => normalize(operation.sourceRelativePath) === '.zcode/skills/tdd-workflow'));
  assert.ok(plan.operations.every(operation => (
    operation.destinationPath === plan.targetRoot
      || operation.destinationPath.startsWith(`${plan.targetRoot}${path.sep}`)
  )));
});

test('keeps hooks out of the managed ZCode projection and routes them to the native plugin', () => {
  const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
  const plan = resolveInstallPlan({
    target: 'zcode',
    repoRoot,
    projectRoot: repoRoot,
    homeDir: '/Users/example',
  });
  assert.strictEqual(plan.profileId, 'full');
  assert.ok(plan.skippedModuleIds.includes('hooks-runtime'));
  assert.ok(!plan.excludedModuleIds.includes('hooks-runtime'));
  assert.deepStrictEqual(plan.warnings, []);
  assert.ok(!plan.operations.some(operation => operation.moduleId === 'hooks-runtime'));
});

test('plans one adapted ZCode skill without installing the whole catalog', () => {
  const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
  const plan = resolveInstallPlan({
    includeComponentIds: ['skill:continuous-learning-v2'],
    target: 'zcode',
    repoRoot,
    projectRoot: repoRoot,
    homeDir: '/Users/example',
  });
  assert.deepStrictEqual(plan.selectedModuleIds, ['skill-continuous-learning-v2']);
  assert.ok(plan.operations.some(operation => normalize(operation.sourceRelativePath) === '.zcode/skills/continuous-learning-v2'));
  assert.ok(!plan.operations.some(operation => normalize(operation.sourceRelativePath) === '.zcode/skills/vue-patterns'));
});

test('CLI dry-run emits a contained ZCode install plan without changing the temporary home', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-project-'));
  try {
    const output = execFileSync('node', [
      path.join(repoRoot, 'scripts', 'install-apply.js'),
      '--profile', 'minimal',
      '--target', 'zcode',
      '--dry-run',
      '--json',
    ], {
      cwd: projectDir,
      env: { ...process.env, HOME: homeDir },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.plan.target, 'zcode');
    assert.strictEqual(parsed.plan.adapter.id, 'zcode-home');
    assert.strictEqual(parsed.plan.installRoot, path.join(homeDir, '.zcode'));
    assert.ok(parsed.plan.operations.length > 0);
    assert.ok(!fs.existsSync(path.join(homeDir, '.zcode')));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('installs and uninstalls only managed ZCode files in an isolated home', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-project-'));
  const env = { ...process.env, HOME: homeDir };
  try {
    const installOutput = execFileSync('node', [
      path.join(repoRoot, 'scripts', 'install-apply.js'),
      '--profile', 'minimal',
      '--target', 'zcode',
      '--json',
    ], {
      cwd: projectDir,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const installed = JSON.parse(installOutput);
    const zcodeRoot = path.join(homeDir, '.zcode');
    const statePath = path.join(zcodeRoot, 'ecc-install-state.json');
    const unrelatedPath = path.join(zcodeRoot, 'user-note.txt');
    assert.strictEqual(installed.dryRun, false);
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'commands', 'plan.md')));
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'skills', 'ecc-agent-planner', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'scripts', 'github-coordination.js')));
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'manifests', 'install-modules.json')));
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'schemas', 'ecc-install-config.schema.json')));
    assert.ok(fs.existsSync(path.join(zcodeRoot, 'package.json')));
    assert.ok(fs.existsSync(statePath));
    const managedPlan = JSON.parse(execFileSync(process.execPath, [
      path.join(zcodeRoot, 'scripts', 'install-plan.js'),
      '--profile', 'minimal',
      '--target', 'zcode',
      '--json',
    ], {
      cwd: projectDir,
      env,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }));
    assert.ok(managedPlan.operations.some(operation => normalize(operation.sourceRelativePath) === 'commands'));
    fs.writeFileSync(unrelatedPath, 'preserve me', 'utf8');

    const uninstallOutput = execFileSync('node', [
      uninstallScript,
      '--target', 'zcode',
      '--json',
    ], {
      cwd: projectDir,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const uninstalled = JSON.parse(uninstallOutput);
    assert.strictEqual(uninstalled.summary.errorCount, 0);
    assert.strictEqual(uninstalled.summary.uninstalledCount, 1);
    assert.ok(!fs.existsSync(statePath));
    assert.ok(!fs.existsSync(path.join(zcodeRoot, 'commands', 'plan.md')));
    assert.ok(!fs.existsSync(path.join(zcodeRoot, 'scripts', 'github-coordination.js')));
    assert.ok(!fs.existsSync(path.join(zcodeRoot, 'manifests', 'install-modules.json')));
    assert.ok(fs.existsSync(unrelatedPath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
