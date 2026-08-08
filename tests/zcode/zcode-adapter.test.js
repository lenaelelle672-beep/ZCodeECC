const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const builderPath = path.join(repoRoot, 'scripts', 'zcode', 'build-adapter.js');
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

test('builds a native ZCode plugin with exact ECC 2.2.0 surface counts', () => {
  const { outputRoot, result } = buildFixture();
  try {
    const manifest = readJson(path.join(outputRoot, '.zcode-plugin', 'plugin.json'));
    const compatibility = readJson(path.join(outputRoot, '.zcode', 'compatibility-manifest.json'));
    const counts = sourceCounts();

    assert.strictEqual(manifest.name, 'zcode-ecc');
    assert.strictEqual(manifest.version, '2.2.0');
    assert.strictEqual(manifest.skills, '.zcode/skills');
    assert.strictEqual(manifest.commands, '.zcode/commands');
    assert.strictEqual(manifest.hooks, '.zcode/hooks/hooks.json');
    assert.deepStrictEqual(manifest.mcpServers, {});
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
    assert.strictEqual(preCompact.targetEvent, 'SessionStart');
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

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
