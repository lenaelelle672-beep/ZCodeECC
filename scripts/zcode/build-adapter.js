#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  adaptAgentMarkdown,
  adaptCommandMarkdown,
  adaptSkillMarkdown,
  clampDescription,
  normalizeHookMatcher,
  transformHarnessText,
} = require('./transforms');

const GENERATED_MARKER = '.generated-by-zcode-ecc';
const ZCODE_WORKSPACE_ROOT = '.zcode';
const ZCODE_PLUGIN_ROOT = path.join('plugins', 'zcode-ecc');
const TEXT_EXTENSIONS = new Set([
  '.cfg', '.cjs', '.ini', '.js', '.json', '.jsx', '.md', '.mdx', '.mjs',
  '.ps1', '.py', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const SUPPORTED_HOOK_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value, mode = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = value.replace(/[ \t]+$/gm, '');
  fs.writeFileSync(filePath, normalized, 'utf8');
  if (mode !== null) fs.chmodSync(filePath, mode);
}

function listDirectories(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
}

function listFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function assertSafeOutputRoot(outputRoot) {
  const resolved = path.resolve(outputRoot);
  if (resolved === path.parse(resolved).root) {
    throw new Error('Refusing to generate ZCode adapter at a filesystem root');
  }
  return resolved;
}

function prepareGeneratedDirectory(outputRoot, relativePath) {
  const target = path.join(outputRoot, relativePath);
  if (fs.existsSync(target)) {
    const marker = path.join(target, GENERATED_MARKER);
    if (!fs.existsSync(marker)) {
      throw new Error(`Refusing to replace non-generated directory: ${target}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, GENERATED_MARKER), 'scripts/zcode/build-adapter.js\n', 'utf8');
  return target;
}

function removeGeneratedDirectory(outputRoot, relativePath) {
  const target = path.join(outputRoot, relativePath);
  if (!fs.existsSync(target)) return;
  const marker = path.join(target, GENERATED_MARKER);
  if (!fs.existsSync(marker)) {
    throw new Error(`Refusing to remove non-generated directory: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function copyRawTree(sourceRoot, destinationRoot, options = {}) {
  const excluded = new Set(options.exclude || []);
  for (const relativePath of listFiles(sourceRoot)) {
    const normalized = relativePath.split(path.sep).join('/');
    if (excluded.has(normalized)) continue;
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    const stat = fs.statSync(sourcePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, stat.mode);
  }
}

function copyAdaptedTree(sourceRoot, destinationRoot) {
  for (const relativePath of listFiles(sourceRoot)) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const stat = fs.statSync(sourcePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (TEXT_EXTENSIONS.has(extension)) {
      writeText(
        destinationPath,
        transformHarnessText(fs.readFileSync(sourcePath, 'utf8')),
        stat.mode
      );
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
      fs.chmodSync(destinationPath, stat.mode);
    }
  }
}

function buildSkills(repoRoot, zcodeRoot, artifacts) {
  const sourceRoot = path.join(repoRoot, 'skills');
  const destinationRoot = path.join(zcodeRoot, 'skills');
  const skillIds = listDirectories(sourceRoot);

  for (const skillId of skillIds) {
    const sourceDir = path.join(sourceRoot, skillId);
    const destinationDir = path.join(destinationRoot, skillId);
    copyAdaptedTree(sourceDir, destinationDir);
    const sourceSkillPath = path.join(sourceDir, 'SKILL.md');
    const targetSkillPath = path.join(destinationDir, 'SKILL.md');
    writeText(
      targetSkillPath,
      adaptSkillMarkdown(fs.readFileSync(sourceSkillPath, 'utf8'), skillId),
      fs.statSync(sourceSkillPath).mode
    );
    artifacts.push({
      kind: 'skills',
      source: path.posix.join('skills', skillId, 'SKILL.md'),
      target: path.posix.join('.zcode', 'skills', skillId, 'SKILL.md'),
      targetType: 'file',
      status: 'adapted',
      note: 'Frontmatter is reduced to ZCode-compatible name/description fields and harness paths are projected to ZCode.',
    });
  }
}

function buildAgentSkills(repoRoot, zcodeRoot, artifacts) {
  const sourceRoot = path.join(repoRoot, 'agents');
  const destinationRoot = path.join(zcodeRoot, 'skills');
  const files = fs.readdirSync(sourceRoot).filter(name => name.endsWith('.md')).sort();

  for (const fileName of files) {
    const sourcePath = path.join(sourceRoot, fileName);
    const fallbackName = path.basename(fileName, '.md');
    const adapted = adaptAgentMarkdown(fs.readFileSync(sourcePath, 'utf8'), fallbackName);
    const targetRelative = path.posix.join(
      '.zcode', 'skills', adapted.skillName, 'SKILL.md'
    );
    writeText(path.join(destinationRoot, adapted.skillName, 'SKILL.md'), adapted.content);
    artifacts.push({
      kind: 'agents',
      source: path.posix.join('agents', fileName),
      target: targetRelative,
      targetType: 'file',
      status: 'limited',
      note: 'Converted to a ZCode role skill; original model/tool enforcement and isolated agent execution are not available.',
    });
  }
}

function buildRuleSkills(repoRoot, zcodeRoot, artifacts) {
  const sourceRoot = path.join(repoRoot, 'rules');
  const destinationRoot = path.join(zcodeRoot, 'skills');
  const families = listDirectories(sourceRoot);

  for (const family of families) {
    const skillName = `ecc-rules-${family}`;
    const skillRoot = path.join(destinationRoot, skillName);
    const referencesRoot = path.join(skillRoot, 'references');
    const familyFiles = listFiles(path.join(sourceRoot, family)).filter(name => name.endsWith('.md'));
    const sourceFiles = family === 'common'
      ? ['README.md', ...familyFiles.map(name => path.join(family, name))]
      : familyFiles.map(name => path.join(family, name));

    for (const sourceRelative of sourceFiles) {
      const sourcePath = path.join(sourceRoot, sourceRelative);
      const referenceRelative = sourceRelative === 'README.md'
        ? 'README.md'
        : path.relative(family, sourceRelative);
      const targetPath = path.join(referencesRoot, referenceRelative);
      writeText(targetPath, transformHarnessText(fs.readFileSync(sourcePath, 'utf8')));
      artifacts.push({
        kind: 'rules',
        source: path.posix.join('rules', sourceRelative.split(path.sep).join('/')),
        target: path.posix.join(
          '.zcode', 'skills', skillName, 'references', referenceRelative.split(path.sep).join('/')
        ),
        targetType: 'file',
        status: 'adapted',
        note: `Included in the ${family} ZCode rule-pack skill.`,
      });
    }

    const referenceList = sourceFiles.map(sourceRelative => {
      const referenceRelative = sourceRelative === 'README.md'
        ? 'README.md'
        : path.relative(family, sourceRelative).split(path.sep).join('/');
      return `- Read [${referenceRelative}](references/${referenceRelative}) when it applies.`;
    });
    const description = clampDescription(
      `Use this ZCode skill when implementing, reviewing, testing, securing, or diagnosing ${family} code with the ECC rule set.`
    );
    const skillBody = [
      '---',
      `name: ${JSON.stringify(skillName)}`,
      `description: ${JSON.stringify(description)}`,
      '---',
      '',
      `# ECC ${family} rules for ZCode`,
      '',
      'Apply only the references relevant to the current repository and user request. Repository instructions and user scope remain authoritative.',
      '',
      ...referenceList,
      '',
    ].join('\n');
    writeText(path.join(skillRoot, 'SKILL.md'), skillBody);
  }
}

function buildCommands(repoRoot, zcodeRoot, artifacts) {
  const sourceRoot = path.join(repoRoot, 'commands');
  const destinationRoot = path.join(zcodeRoot, 'commands');
  const files = fs.readdirSync(sourceRoot).filter(name => name.endsWith('.md')).sort();

  for (const fileName of files) {
    const sourcePath = path.join(sourceRoot, fileName);
    const targetPath = path.join(destinationRoot, fileName);
    writeText(targetPath, adaptCommandMarkdown(fs.readFileSync(sourcePath, 'utf8')));
    artifacts.push({
      kind: 'commands',
      source: path.posix.join('commands', fileName),
      target: path.posix.join('.zcode', 'commands', fileName),
      targetType: 'file',
      status: 'adapted',
      note: 'Uses only ZCode command frontmatter keys and ZCode harness paths.',
    });
  }
}

function hookTimeoutMs(group) {
  const timeouts = (group.hooks || []).map(hook => (
    hook.timeoutMs || (hook.timeout ? hook.timeout * 1000 : 60000)
  ));
  return Math.max(...timeouts, 60000) + 5000;
}

function bridgeHook(sourceEvent, group, targetEvent, matcher) {
  return {
    matcher,
    hooks: [
      {
        type: 'process',
        command: '${ZCODE_PLUGIN_ROOT}/scripts/zcode/hook-bridge.js',
        args: [sourceEvent, group.id, targetEvent],
        timeoutMs: hookTimeoutMs(group),
        statusMessage: `ZCodeECC: ${group.id}`,
      },
    ],
  };
}

function buildHooks(repoRoot, zcodeRoot, artifacts) {
  const sourceHooks = readJson(path.join(repoRoot, 'hooks', 'hooks.json')).hooks;
  const targetHooks = {};

  for (const [sourceEvent, groups] of Object.entries(sourceHooks)) {
    for (const group of groups) {
      const source = `hooks/hooks.json#${sourceEvent}/${group.id}`;
      const hasAsync = (group.hooks || []).some(hook => hook.async === true);

      if (sourceEvent === 'SessionEnd') {
        artifacts.push({
          kind: 'hooks',
          source,
          sourceEvent,
          target: '.zcode/hooks/hooks.json#Stop/stop:session-end',
          targetType: 'hook',
          targetEvent: 'Stop',
          status: 'limited',
          note: 'ZCode has no SessionEnd event. Stop persistence remains available, but final-session cleanup cannot be timed equivalently.',
        });
        continue;
      }

      const targetEvent = sourceEvent === 'PreCompact' ? 'SessionStart' : sourceEvent;
      if (!SUPPORTED_HOOK_EVENTS.has(targetEvent)) {
        throw new Error(`No ZCode mapping for hook event ${sourceEvent}`);
      }
      const matcher = sourceEvent === 'PreCompact'
        ? 'compact'
        : normalizeHookMatcher(group.matcher);
      if (!targetHooks[targetEvent]) targetHooks[targetEvent] = [];
      targetHooks[targetEvent].push(bridgeHook(sourceEvent, group, targetEvent, matcher));

      let status = 'adapted';
      const notes = ['Runs through a bridge that sanitizes stdout to ZCode hook output fields.'];
      if (sourceEvent === 'PreCompact') {
        status = 'limited';
        notes.push('ZCode has no PreCompact event, so this runs on SessionStart(compact) after compaction.');
      }
      if (hasAsync) {
        status = 'limited';
        notes.push('ZCode ignores async; this hook runs inline.');
      }
      artifacts.push({
        kind: 'hooks',
        source,
        sourceEvent,
        target: `.zcode/hooks/hooks.json#${targetEvent}/${group.id}`,
        targetType: 'hook',
        targetEvent,
        status,
        note: notes.join(' '),
      });
    }
  }

  writeJson(path.join(zcodeRoot, 'hooks', 'hooks.json'), { hooks: targetHooks });
}

function canonicalMcpServer(server) {
  const result = {};
  if (server.command) {
    result.type = 'stdio';
    result.command = server.command;
    if (Array.isArray(server.args)) result.args = server.args;
    if (server.cwd) result.cwd = transformHarnessText(server.cwd);
    if (server.env && typeof server.env === 'object') result.env = server.env;
  } else if (server.url) {
    result.type = server.type === 'sse' ? 'sse' : 'http';
    result.url = server.url;
    if (server.headers && typeof server.headers === 'object') result.headers = server.headers;
  } else {
    throw new Error('MCP server requires command or url');
  }
  if (server.timeoutMs) result.timeoutMs = server.timeoutMs;
  result.enabled = false;
  return result;
}

function buildMcpFragments(repoRoot, zcodeRoot, artifacts) {
  const catalog = readJson(path.join(repoRoot, 'mcp-configs', 'mcp-servers.json')).mcpServers;
  const legacy = readJson(path.join(repoRoot, '.mcp.json')).mcpServers;
  const sources = [
    ...Object.entries(catalog).map(([name, config]) => ({
      name,
      config,
      source: `mcp-configs/mcp-servers.json#${name}`,
    })),
    ...Object.entries(legacy).map(([name, config]) => ({
      name,
      config,
      source: `.mcp.json#${name}`,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sources) {
    const target = path.posix.join('.zcode', 'mcp', 'servers', `${entry.name}.json`);
    writeJson(path.join(zcodeRoot, 'mcp', 'servers', `${entry.name}.json`), {
      mcp: {
        servers: {
          [entry.name]: canonicalMcpServer(entry.config),
        },
      },
    });
    artifacts.push({
      kind: 'mcp',
      source: entry.source,
      target,
      targetType: 'file',
      status: 'opt-in',
      note: clampDescription(
        `Disabled ZCode config fragment. Review command, network, credentials, and data boundary before enabling. ${entry.config.description || ''}`
      ),
    });
  }

  writeText(path.join(zcodeRoot, 'mcp', 'README.md'), [
    '# Optional MCP fragments',
    '',
    'ZCode auto-connects every configured MCP server. ZCodeECC therefore declares no MCP server in the primary plugin manifest.',
    '',
    'Each file in `servers/` uses the strict `mcp.servers` schema and starts with `enabled: false`. Copy only the server you need into a ZCode configuration, replace placeholders out of band, review its command/network/data boundary, then enable it explicitly.',
    '',
  ].join('\n'));
}

function buildPluginManifest(repoRoot, pluginRoot, sourceCounts) {
  const packageJson = readJson(path.join(repoRoot, 'package.json'));
  const manifest = {
    name: 'zcode-ecc',
    version: packageJson.version,
    description: `ZCode-native ECC ${packageJson.version}: ${sourceCounts.agents} agent role skills, ${sourceCounts.skills} workflow skills, ${sourceCounts.commands} commands, ${sourceCounts.rules} rules, adapted hooks, and opt-in MCP fragments.`,
    author: {
      name: 'Affaan Mustafa and ZCodeECC maintainers',
      url: 'https://github.com/affaan-m/ECC',
    },
    homepage: 'https://github.com/lenaelelle672-beep/ZCodeECC',
    repository: 'https://github.com/lenaelelle672-beep/ZCodeECC',
    license: 'MIT',
    skills: 'skills',
    commands: 'commands',
    mcpServers: {},
  };
  writeJson(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'), manifest);
}

function buildReadme(targetRoot, sourceCounts, options = {}) {
  const pluginBundle = options.pluginBundle === true;
  writeText(path.join(targetRoot, 'README.md'), [
    pluginBundle ? '# ZCodeECC native plugin' : '# ZCodeECC workspace projection',
    '',
    `Generated from ECC 2.2.0: ${sourceCounts.agents} agents, ${sourceCounts.skills} skills, ${sourceCounts.commands} commands, ${sourceCounts.rules} rules, ${sourceCounts.hooks} hooks, and ${sourceCounts.mcp} optional MCP definitions.`,
    '',
    'Do not edit generated files directly. Change the canonical ECC source or `scripts/zcode/`, then run `npm run build:zcode`.',
    '',
    pluginBundle
      ? 'Important: ZCode plugin hooks are runnable immediately when the plugin is enabled. Review `hooks/hooks.json` and `compatibility-manifest.json` before enabling the plugin. Hooks marked `limited` cannot preserve Claude event timing exactly.'
      : 'This workspace projection does not activate hooks by itself. Use the isolated plugin under `plugins/zcode-ecc/` for native plugin loading.',
    '',
    `MCP servers are not enabled by the plugin. Review the disabled fragments under \`${pluginBundle ? 'mcp' : '.zcode/mcp'}/servers/\` and opt in one server at a time.`,
    '',
  ].join('\n'));
}

function mapBundleTarget(target) {
  if (typeof target !== 'string') return target;
  return target
    .replace(/^\.zcode\/skills\//, 'skills/')
    .replace(/^\.zcode\/commands\//, 'commands/')
    .replace(/^\.zcode\/hooks\//, 'hooks/')
    .replace(/^\.zcode\/mcp\//, 'mcp/');
}

function buildPluginBundle(repoRoot, outputRoot, zcodeRoot, compatibility, sourceCounts) {
  const pluginRoot = prepareGeneratedDirectory(outputRoot, ZCODE_PLUGIN_ROOT);

  for (const component of ['skills', 'commands', 'hooks', 'mcp']) {
    copyRawTree(path.join(zcodeRoot, component), path.join(pluginRoot, component));
  }

  copyAdaptedTree(path.join(repoRoot, 'scripts', 'hooks'), path.join(pluginRoot, 'scripts', 'hooks'));
  copyAdaptedTree(path.join(repoRoot, 'scripts', 'lib'), path.join(pluginRoot, 'scripts', 'lib'));
  copyRawTree(
    path.join(repoRoot, 'scripts', 'zcode'),
    path.join(pluginRoot, 'scripts', 'zcode'),
    { exclude: ['build-adapter.js', 'frontmatter.js', 'transforms.js'] }
  );
  copyRawTree(path.join(repoRoot, 'config'), path.join(pluginRoot, 'config'));
  copyRawTree(path.join(repoRoot, 'schemas'), path.join(pluginRoot, 'schemas'));
  fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(pluginRoot, 'package.json'));
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(pluginRoot, 'VERSION'));
  writeJson(
    path.join(pluginRoot, 'runtime', 'canonical-hooks.json'),
    JSON.parse(transformHarnessText(fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8')))
  );

  const bundleCompatibility = {
    ...compatibility,
    artifacts: compatibility.artifacts.map(record => ({
      ...record,
      target: mapBundleTarget(record.target),
    })),
  };
  writeJson(path.join(pluginRoot, 'compatibility-manifest.json'), bundleCompatibility);
  buildPluginManifest(repoRoot, pluginRoot, sourceCounts);
  buildReadme(pluginRoot, sourceCounts, { pluginBundle: true });
  return pluginRoot;
}

function countArtifacts(artifacts) {
  return Object.fromEntries(
    ['agents', 'commands', 'skills', 'rules', 'hooks', 'mcp']
      .map(kind => [kind, artifacts.filter(record => record.kind === kind).length])
  );
}

function buildZcodeAdapter(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  const outputRoot = assertSafeOutputRoot(options.outputRoot || repoRoot);
  const packageJson = readJson(path.join(repoRoot, 'package.json'));
  if (packageJson.version !== '2.2.0') {
    throw new Error(`ZCode adapter baseline requires ECC 2.2.0, found ${packageJson.version}`);
  }

  const zcodeRoot = prepareGeneratedDirectory(outputRoot, ZCODE_WORKSPACE_ROOT);
  removeGeneratedDirectory(outputRoot, '.zcode-plugin');
  const artifacts = [];

  buildSkills(repoRoot, zcodeRoot, artifacts);
  buildAgentSkills(repoRoot, zcodeRoot, artifacts);
  buildRuleSkills(repoRoot, zcodeRoot, artifacts);
  buildCommands(repoRoot, zcodeRoot, artifacts);
  buildHooks(repoRoot, zcodeRoot, artifacts);
  buildMcpFragments(repoRoot, zcodeRoot, artifacts);

  artifacts.sort((left, right) => (
    left.kind.localeCompare(right.kind) || left.source.localeCompare(right.source)
  ));
  const sourceCounts = countArtifacts(artifacts);
  const compatibility = {
    schemaVersion: 1,
    adapter: 'zcode-ecc',
    source: {
      repository: 'https://github.com/affaan-m/ECC',
      version: packageJson.version,
      baselineCommit: '59a99d669f5466d99d5be8b6fce8c5f2677766d0',
    },
    sourceCounts,
    statusDefinitions: {
      native: 'No semantic adaptation required.',
      adapted: 'Projected to a supported ZCode surface.',
      limited: 'Available with a documented runtime or timing difference.',
      'opt-in': 'Generated but disabled until the operator explicitly enables it.',
    },
    artifacts,
  };
  writeJson(path.join(zcodeRoot, 'compatibility-manifest.json'), compatibility);
  buildReadme(zcodeRoot, sourceCounts);
  buildPluginBundle(repoRoot, outputRoot, zcodeRoot, compatibility, sourceCounts);

  return { outputRoot, sourceCounts, artifactCount: artifacts.length };
}

function compareGeneratedTrees(expectedRoot, actualRoot) {
  const drift = [];
  for (const generatedRoot of [ZCODE_WORKSPACE_ROOT, '.zcode-plugin', ZCODE_PLUGIN_ROOT]) {
    const expectedDir = path.join(expectedRoot, generatedRoot);
    const actualDir = path.join(actualRoot, generatedRoot);
    const expectedFiles = listFiles(expectedDir).map(file => path.join(generatedRoot, file));
    const actualFiles = listFiles(actualDir).map(file => path.join(generatedRoot, file));
    const allFiles = [...new Set([...expectedFiles, ...actualFiles])].sort();
    for (const relativePath of allFiles) {
      const expectedPath = path.join(expectedRoot, relativePath);
      const actualPath = path.join(actualRoot, relativePath);
      if (!fs.existsSync(expectedPath) || !fs.existsSync(actualPath)) {
        drift.push(relativePath.split(path.sep).join('/'));
        continue;
      }
      if (!fs.readFileSync(expectedPath).equals(fs.readFileSync(actualPath))) {
        drift.push(relativePath.split(path.sep).join('/'));
      }
    }
  }
  return drift;
}

function checkZcodeAdapter(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  const outputRoot = path.resolve(options.outputRoot || repoRoot);
  const expectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-check-'));
  try {
    buildZcodeAdapter({ repoRoot, outputRoot: expectedRoot });
    return { drift: compareGeneratedTrees(expectedRoot, outputRoot) };
  } finally {
    fs.rmSync(expectedRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { check: false, outputRoot: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--check') result.check = true;
    else if (args[index] === '--output') result.outputRoot = args[++index];
    else if (args[index] === '--help' || args[index] === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/zcode/build-adapter.js [--check] [--output <directory>]');
    return;
  }
  const repoRoot = path.resolve(__dirname, '../..');
  const outputRoot = args.outputRoot ? path.resolve(args.outputRoot) : repoRoot;
  if (args.check) {
    const result = checkZcodeAdapter({ repoRoot, outputRoot });
    if (result.drift.length > 0) {
      process.stderr.write(`ZCode adapter drift:\n${result.drift.map(file => `- ${file}`).join('\n')}\n`);
      process.exit(1);
    }
    console.error('ZCode adapter is up to date.');
    return;
  }
  const result = buildZcodeAdapter({ repoRoot, outputRoot });
  console.error(`Generated ${result.artifactCount} ZCode compatibility records.`);
}

if (require.main === module) main();

module.exports = {
  buildZcodeAdapter,
  checkZcodeAdapter,
};
