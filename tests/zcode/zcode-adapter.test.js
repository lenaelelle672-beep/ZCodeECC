const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const builderPath = path.join(repoRoot, 'scripts', 'zcode', 'build-adapter.js');
const pluginRelativeRoot = path.join('plugins', 'zcode-ecc');
const supportedHookEvents = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
]);

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

function listDirectories(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseFlatFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, 'expected markdown frontmatter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z0-9_-]+):\s*(.*)$/i);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

function sourceCounts() {
  const hooks = readJson(path.join(repoRoot, 'hooks', 'hooks.json')).hooks;
  const optionalMcpServers = {
    ...readJson(path.join(repoRoot, 'mcp-configs', 'mcp-servers.json')).mcpServers,
    ...readJson(path.join(repoRoot, '.mcp.json')).mcpServers,
  };
  return {
    agents: fs.readdirSync(path.join(repoRoot, 'agents')).filter(name => name.endsWith('.md')).length,
    commands: fs.readdirSync(path.join(repoRoot, 'commands')).filter(name => name.endsWith('.md')).length,
    skills: listDirectories(path.join(repoRoot, 'skills')).length,
    rules: fs.readdirSync(path.join(repoRoot, 'rules'), { recursive: true })
      .filter(name => name.endsWith('.md')).length,
    hooks: Object.values(hooks).flatMap(groups => groups.flatMap(group => group.hooks || [])).length,
    mcp: Object.keys(optionalMcpServers).length,
  };
}

function buildFixture() {
  assert.ok(fs.existsSync(builderPath), 'missing scripts/zcode/build-adapter.js');
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-adapter-'));
  const { buildZcodeAdapter } = require(builderPath);
  const result = buildZcodeAdapter({ repoRoot, outputRoot });
  return { outputRoot, result };
}

console.log('\n=== Testing ZCode native adapter ===\n');

test('publishes the isolated ZCode plugin through the repository marketplace', () => {
  const marketplace = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
  const zcodeEntry = marketplace.plugins.find(plugin => plugin.name === 'zcode-ecc');
  assert.ok(zcodeEntry, 'missing zcode-ecc marketplace entry');
  assert.strictEqual(zcodeEntry.source, './plugins/zcode-ecc');
  assert.strictEqual(zcodeEntry.version, '2.2.0');
  const packageJson = readJson(path.join(repoRoot, 'package.json'));
  assert.ok(packageJson.files.includes('plugins/zcode-ecc/'));
});

test('builds a native ZCode plugin with exact ECC 2.2.0 surface counts', () => {
  const { outputRoot, result } = buildFixture();
  try {
    const pluginRoot = path.join(outputRoot, pluginRelativeRoot);
    const manifest = readJson(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'));
    const compatibility = readJson(path.join(outputRoot, '.zcode', 'compatibility-manifest.json'));
    const counts = sourceCounts();

    assert.strictEqual(manifest.name, 'zcode-ecc');
    assert.strictEqual(manifest.version, '2.2.0');
    assert.strictEqual(manifest.skills, 'skills');
    assert.strictEqual(manifest.commands, 'commands');
    assert.ok(!Object.hasOwn(manifest, 'hooks'));
    assert.deepStrictEqual(manifest.mcpServers, {});
    assert.ok(!fs.existsSync(path.join(outputRoot, '.zcode-plugin', 'plugin.json')));
    assert.deepStrictEqual(compatibility.sourceCounts, counts);
    assert.deepStrictEqual(result.sourceCounts, counts);
    assert.deepStrictEqual(counts, {
      agents: 67,
      commands: 94,
      skills: 284,
      rules: 122,
      hooks: 21,
      mcp: 36,
    });
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('builds an isolated plugin without canonical auto-discovery surfaces', () => {
  const { outputRoot } = buildFixture();
  try {
    const pluginRoot = path.join(outputRoot, pluginRelativeRoot);
    const pluginCompatibility = readJson(path.join(pluginRoot, 'compatibility-manifest.json'));
    assert.strictEqual(listDirectories(path.join(pluginRoot, 'skills')).length, 284 + 67 + 22);
    assert.strictEqual(fs.readdirSync(path.join(pluginRoot, 'commands')).filter(name => name.endsWith('.md')).length, 94);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'runtime', 'canonical-hooks.json')));
    assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', 'zcode', 'hook-bridge.js')));
    assert.ok(!fs.existsSync(path.join(pluginRoot, '.mcp.json')));
    assert.ok(pluginCompatibility.artifacts.every(record => !String(record.target).startsWith('.zcode/')));

    const canonicalHooks = fs.readFileSync(path.join(pluginRoot, 'runtime', 'canonical-hooks.json'), 'utf8');
    const resolvedRuntime = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'resolve-ecc-root.js'), 'utf8');
    assert.match(canonicalHooks, /CLAUDE_PLUGIN_ROOT/);
    assert.match(resolvedRuntime, /CLAUDE_PLUGIN_ROOT/);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', 'auto-update.js')));
    assert.doesNotMatch(
      fs.readFileSync(path.join(pluginRoot, 'skills', 'configure-ecc', 'SKILL.md'), 'utf8'),
      /scripts\/setup\.js/
    );

    const pluginHooks = readJson(path.join(pluginRoot, 'hooks', 'hooks.json')).hooks;
    assert.ok(Object.keys(pluginHooks).every(event => supportedHookEvents.has(event)));
    assert.ok(!Object.hasOwn(pluginHooks, 'PreCompact'));
    assert.ok(!Object.hasOwn(pluginHooks, 'SessionEnd'));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('maps every source artifact exactly once and creates every declared target', () => {
  const { outputRoot } = buildFixture();
  try {
    const compatibility = readJson(path.join(outputRoot, '.zcode', 'compatibility-manifest.json'));
    const counts = sourceCounts();

    for (const [kind, expectedCount] of Object.entries(counts)) {
      const records = compatibility.artifacts.filter(record => record.kind === kind);
      assert.strictEqual(records.length, expectedCount, `${kind} compatibility count`);
      assert.strictEqual(new Set(records.map(record => record.source)).size, expectedCount, `${kind} source uniqueness`);
      for (const record of records) {
        assert.ok(['native', 'adapted', 'limited', 'opt-in'].includes(record.status), `${record.source} has invalid status`);
        assert.ok(record.target, `${record.source} is missing a target`);
      }
    }

    const fileTargets = compatibility.artifacts.filter(record => record.targetType === 'file');
    for (const record of fileTargets) {
      assert.ok(fs.existsSync(path.join(outputRoot, record.target)), `${record.target} does not exist`);
    }
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('projects all agents and rule families into discoverable ZCode skills', () => {
  const { outputRoot } = buildFixture();
  try {
    const skillRoot = path.join(outputRoot, '.zcode', 'skills');
    const generatedSkills = listDirectories(skillRoot);
    assert.strictEqual(generatedSkills.length, 284 + 67 + 22);

    const planner = fs.readFileSync(path.join(skillRoot, 'ecc-agent-planner', 'SKILL.md'), 'utf8');
    const plannerFrontmatter = parseFlatFrontmatter(planner);
    assert.strictEqual(plannerFrontmatter.name, 'ecc-agent-planner');
    assert.match(plannerFrontmatter.description, /ZCode/i);
    assert.ok(plannerFrontmatter.description.length <= 1024);
    assert.match(planner, /role skill/i);
    assert.match(planner, /cannot enforce|does not enforce/i);

    for (const skillName of generatedSkills.filter(name => name.startsWith('ecc-agent-'))) {
      const source = fs.readFileSync(path.join(skillRoot, skillName, 'SKILL.md'), 'utf8');
      assert.strictEqual((source.match(/^# /gm) || []).length, 1, `${skillName} has multiple H1 headings`);
    }

    const commonRules = path.join(skillRoot, 'ecc-rules-common');
    assert.ok(fs.existsSync(path.join(commonRules, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(commonRules, 'references', 'security.md')));
    assert.ok(fs.existsSync(path.join(commonRules, 'references', 'README.md')));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('normalizes ZCode command frontmatter and harness paths', () => {
  const { outputRoot } = buildFixture();
  try {
    const plan = fs.readFileSync(path.join(outputRoot, '.zcode', 'commands', 'plan.md'), 'utf8');
    const planFrontmatter = parseFlatFrontmatter(plan);
    assert.deepStrictEqual(
      Object.keys(planFrontmatter).sort(),
      ['argument-hint', 'description']
    );
    assert.match(plan, /\.zcode\/plans/);
    assert.doesNotMatch(plan, /\.claude\/plans/);

    const securityScan = fs.readFileSync(
      path.join(outputRoot, '.zcode', 'commands', 'security-scan.md'),
      'utf8'
    );
    const securityFrontmatter = parseFlatFrontmatter(securityScan);
    assert.strictEqual(securityFrontmatter.skills, 'ecc-agent-security-reviewer');
    assert.ok(!Object.hasOwn(securityFrontmatter, 'agent'));
    assert.ok(!Object.hasOwn(securityFrontmatter, 'subtask'));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('uses semantic overrides and labels remaining harness-only workflows as limited', () => {
  const { outputRoot } = buildFixture();
  try {
    const compatibility = readJson(path.join(outputRoot, '.zcode', 'compatibility-manifest.json'));
    const configure = fs.readFileSync(
      path.join(outputRoot, '.zcode', 'skills', 'configure-ecc', 'SKILL.md'),
      'utf8'
    );
    const autoUpdate = fs.readFileSync(
      path.join(outputRoot, '.zcode', 'commands', 'auto-update.md'),
      'utf8'
    );
    assert.doesNotMatch(configure, /^\s*claude plugin\s+(?:list|marketplace)/im);
    assert.doesNotMatch(configure, /^\s*(?:node|npx).*--mode claude-plugin/im);
    assert.match(configure, /Plugin Management/);
    assert.match(autoUpdate, /Plugin Management/);
    assert.match(autoUpdate, /--target zcode/);

    const configureRecord = compatibility.artifacts.find(record => (
      record.kind === 'skills' && record.source === 'skills/configure-ecc/SKILL.md'
    ));
    const autonomousRecord = compatibility.artifacts.find(record => (
      record.kind === 'skills' && record.source === 'skills/autonomous-loops/SKILL.md'
    ));
    const multiPlanRecord = compatibility.artifacts.find(record => (
      record.kind === 'commands' && record.source === 'commands/multi-plan.md'
    ));
    const ckRecord = compatibility.artifacts.find(record => (
      record.kind === 'skills' && record.source === 'skills/ck/SKILL.md'
    ));
    const epicRecord = compatibility.artifacts.find(record => (
      record.kind === 'commands' && record.source === 'commands/epic-publish.md'
    ));
    assert.strictEqual(configureRecord.status, 'adapted');
    assert.match(configureRecord.note, /semantic override/i);
    assert.strictEqual(autonomousRecord.status, 'limited');
    assert.strictEqual(ckRecord.status, 'limited');
    assert.match(ckRecord.note, /non-Markdown asset/);
    assert.strictEqual(multiPlanRecord.status, 'limited');
    assert.strictEqual(epicRecord.status, 'limited');
    assert.match(epicRecord.note, /sql\.js/);
    assert.match(
      fs.readFileSync(path.join(outputRoot, '.zcode', 'commands', 'multi-plan.md'), 'utf8'),
      /ZCode compatibility boundary/
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('ships command runtime dependencies and emits portable script paths', () => {
  const { outputRoot } = buildFixture();
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-command-home-'));
  try {
    const pluginRoot = path.join(outputRoot, pluginRelativeRoot);
    const epic = fs.readFileSync(path.join(pluginRoot, 'commands', 'epic-publish.md'), 'utf8');
    const setupPm = fs.readFileSync(path.join(pluginRoot, 'commands', 'setup-pm.md'), 'utf8');
    assert.match(epic, /ZCODE_PLUGIN_ROOT:-\$HOME\/\.zcode.*github-coordination\.js/);
    assert.match(setupPm, /ZCODE_PLUGIN_ROOT:-\$HOME\/\.zcode.*setup-package-manager\.js/);
    for (const scriptName of [
      'github-coordination.js',
      'harness-audit.js',
      'install-apply.js',
      'install-plan.js',
      'plan-canvas.js',
      'setup-package-manager.js',
      'skills-health.js',
    ]) {
      assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', scriptName)), `missing ${scriptName}`);
    }
    assert.ok(fs.existsSync(path.join(pluginRoot, 'manifests', 'install-modules.json')));
    const plan = JSON.parse(execFileSync(process.execPath, [
      path.join(pluginRoot, 'scripts', 'install-plan.js'),
      '--profile', 'minimal',
      '--target', 'zcode',
      '--json',
    ], {
      env: { ...process.env, HOME: temporaryHome, ZCODE_PLUGIN_ROOT: pluginRoot },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }));
    assert.strictEqual(plan.target, 'zcode');
    assert.strictEqual(plan.profileId, 'minimal');
    assert.ok(plan.operations.length > 0);
    assert.ok(plan.operations.some(operation => operation.sourceRelativePath === 'commands'));
    const dryRun = JSON.parse(execFileSync(process.execPath, [
      path.join(pluginRoot, 'scripts', 'install-apply.js'),
      '--profile', 'minimal',
      '--target', 'zcode',
      '--dry-run',
      '--json',
    ], {
      env: { ...process.env, HOME: temporaryHome, ZCODE_PLUGIN_ROOT: pluginRoot },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }));
    assert.strictEqual(dryRun.dryRun, true);
    assert.strictEqual(dryRun.plan.target, 'zcode');
    assert.ok(!fs.existsSync(path.join(temporaryHome, '.zcode')));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test('generates only supported ZCode hook events and explicit compatibility limits', () => {
  const { outputRoot } = buildFixture();
  try {
    const hooks = readJson(path.join(outputRoot, '.zcode', 'hooks', 'hooks.json')).hooks;
    const compatibility = readJson(path.join(outputRoot, '.zcode', 'compatibility-manifest.json'));

    for (const event of Object.keys(hooks)) {
      assert.ok(supportedHookEvents.has(event), `unsupported hook event ${event}`);
    }
    for (const groups of Object.values(hooks)) {
      for (const group of groups) {
        assert.notStrictEqual(group.matcher, '*');
        if (group.matcher) assert.doesNotThrow(() => new RegExp(group.matcher));
        assert.doesNotMatch(group.matcher || '', /MultiEdit/);
        for (const hook of group.hooks || []) {
          assert.ok(!Object.hasOwn(hook, 'async'), `${hook.id} retains ignored async flag`);
          assert.doesNotMatch(hook.command || '', /CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR/);
        }
      }
    }

    const hookRecords = compatibility.artifacts.filter(record => record.kind === 'hooks');
    const preCompact = hookRecords.find(record => record.sourceEvent === 'PreCompact');
    const sessionEnd = hookRecords.find(record => record.sourceEvent === 'SessionEnd');
    assert.strictEqual(preCompact.status, 'limited');
    assert.strictEqual(preCompact.targetEvent, 'Stop');
    assert.ok(!Object.values(hooks).flat().some(group => group.matcher === 'compact'));
    assert.strictEqual(sessionEnd.status, 'limited');
    assert.strictEqual(sessionEnd.targetEvent, 'Stop');
    assert.ok(hookRecords.some(record => /runs inline/i.test(record.note || '')));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('builder check mode detects drift and passes after a deterministic rebuild', () => {
  const { outputRoot } = buildFixture();
  try {
    const { buildZcodeAdapter, checkZcodeAdapter } = require(builderPath);
    assert.deepStrictEqual(checkZcodeAdapter({ repoRoot, outputRoot }).drift, []);
    fs.appendFileSync(path.join(outputRoot, '.zcode', 'commands', 'plan.md'), '\nDRIFT\n');
    assert.ok(checkZcodeAdapter({ repoRoot, outputRoot }).drift.includes('.zcode/commands/plan.md'));
    buildZcodeAdapter({ repoRoot, outputRoot });
    assert.deepStrictEqual(checkZcodeAdapter({ repoRoot, outputRoot }).drift, []);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('rebuild preserves unknown ZCode files and removes only marker-owned stale files', () => {
  const { outputRoot } = buildFixture();
  try {
    const { buildZcodeAdapter, checkZcodeAdapter } = require(builderPath);
    const zcodeRoot = path.join(outputRoot, '.zcode');
    const configPath = path.join(zcodeRoot, 'config.json');
    const notePath = path.join(zcodeRoot, 'operator-note.txt');
    const emptyDirectory = path.join(zcodeRoot, 'operator-empty-directory');
    const stalePath = path.join(zcodeRoot, 'obsolete-generated.txt');
    fs.writeFileSync(configPath, '{"plugins":{"enabled":true}}\n');
    fs.writeFileSync(notePath, 'preserve me\n');
    fs.mkdirSync(emptyDirectory);
    fs.writeFileSync(stalePath, 'remove me\n');

    const markerPath = path.join(zcodeRoot, '.generated-by-zcode-ecc');
    const marker = readJson(markerPath);
    marker.files.push('obsolete-generated.txt');
    fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);

    buildZcodeAdapter({ repoRoot, outputRoot });
    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.existsSync(notePath));
    assert.ok(fs.existsSync(emptyDirectory));
    assert.ok(!fs.existsSync(stalePath));
    assert.deepStrictEqual(checkZcodeAdapter({ repoRoot, outputRoot }).drift, []);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('builder refuses live home, unowned targets, and generated-output symlinks', () => {
  const { buildZcodeAdapter } = require(builderPath);
  assert.throws(
    () => buildZcodeAdapter({ repoRoot, outputRoot: os.homedir() }),
    /user home/
  );

  const unownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-unowned-'));
  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-symlink-'));
  try {
    fs.mkdirSync(path.join(unownedRoot, '.zcode'));
    fs.writeFileSync(path.join(unownedRoot, '.zcode', 'config.json'), '{}\n');
    assert.throws(
      () => buildZcodeAdapter({ repoRoot, outputRoot: unownedRoot }),
      /non-generated directory/
    );

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-outside-'));
    fs.symlinkSync(outside, path.join(symlinkRoot, '.zcode'));
    assert.throws(
      () => buildZcodeAdapter({ repoRoot, outputRoot: symlinkRoot }),
      /symlink/
    );
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    fs.rmSync(unownedRoot, { recursive: true, force: true });
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
