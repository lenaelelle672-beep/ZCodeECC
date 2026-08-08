#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_ZCODE_CLI = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const EXPECTED = Object.freeze({
  commands: 94,
  hooks: 19,
  skills: 373,
});

function runCli(cliPath, args, options) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    const reason = result.error?.message || result.signal || result.stderr || `exit ${result.status}`;
    throw new Error(`ZCode ${args.join(' ')} failed: ${String(reason).trim()}`);
  }
  return result.stdout;
}

function runJsonCommand(cliPath, args, options) {
  const stdout = runCli(cliPath, [...args, '--json'], options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`ZCode ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function assertNoDiagnostics(payload, label) {
  const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  assert.deepStrictEqual(
    diagnostics.filter(item => ['error', 'warning'].includes(item.severity)),
    [],
    `${label} emitted warning/error diagnostics`
  );
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateResults(results, pluginRoot) {
  const plugin = results.plugins.plugins.find(record => record.id === 'zcode-ecc@inline');
  assert.ok(plugin, 'ZCode did not discover zcode-ecc@inline');
  assert.strictEqual(plugin.enabled, true);
  assert.strictEqual(plugin.skillCount, EXPECTED.skills);
  assert.strictEqual(plugin.skillRootCount, 1);
  assert.strictEqual(plugin.commandRootCount, 1);
  assert.strictEqual(plugin.hookDetails.length, EXPECTED.hooks);
  assert.deepStrictEqual(plugin.declaredMcpServerNames, []);
  assert.deepStrictEqual(plugin.mcpServerNames, []);
  assert.ok(isInside(plugin.manifestPath, pluginRoot), 'manifest escaped isolated plugin root');
  assert.ok(plugin.hookDetails.every(hook => isInside(hook.sourcePath, pluginRoot)));
  assert.ok(plugin.hookDetails.every(hook => /hook-bridge\.js/.test(hook.command)));

  const skillRecords = results.skills.skills;
  const pluginSkills = skillRecords.filter(record => (
    record.path && isInside(record.path, path.join(pluginRoot, 'skills'))
  ));
  assert.strictEqual(pluginSkills.length, EXPECTED.skills);
  assert.strictEqual(new Set(pluginSkills.map(record => record.name)).size, EXPECTED.skills);

  const commandRecords = results.commands.commands;
  const pluginCommands = commandRecords.filter(record => (
    record.path && isInside(record.path, path.join(pluginRoot, 'commands'))
  ));
  assert.strictEqual(pluginCommands.length, EXPECTED.commands);
  assert.strictEqual(new Set(pluginCommands.map(record => record.name)).size, EXPECTED.commands);

  assertNoDiagnostics(results.plugins, 'plugins list');
  assertNoDiagnostics(results.skills, 'skills list');
  assertNoDiagnostics(results.commands, 'commands list');

  return {
    pluginId: plugin.id,
    version: plugin.version,
    skills: pluginSkills.length,
    commands: pluginCommands.length,
    hooks: plugin.hookDetails.length,
    mcpServersEnabled: plugin.mcpServerNames.length,
    diagnostics: 0,
  };
}

function smokeZcodeCli(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  const pluginRoot = path.join(repoRoot, 'plugins', 'zcode-ecc');
  const cliPath = path.resolve(options.cliPath || process.env.ZCODE_CLI || DEFAULT_ZCODE_CLI);
  assert.ok(fs.existsSync(cliPath), `ZCode CLI not found: ${cliPath}`);
  assert.ok(fs.existsSync(path.join(pluginRoot, '.zcode-plugin', 'plugin.json')), 'Run npm run build:zcode first');

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-ecc-smoke-'));
  const temporaryHome = path.join(temporaryRoot, 'home');
  const workspace = path.join(temporaryRoot, 'workspace');
  const configPath = path.join(temporaryHome, '.zcode', 'cli', 'config.json');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({
    plugins: {
      enabled: true,
      dirs: [pluginRoot],
      enabledPlugins: { 'zcode-ecc@inline': true },
    },
    features: { skill: true },
    skills: { enabled: true },
  }, null, 2)}\n`, 'utf8');

  const commandOptions = {
    cwd: workspace,
    env: { ...process.env, HOME: temporaryHome },
  };
  try {
    const cliVersion = runCli(cliPath, ['version'], commandOptions).trim();
    const results = {
      plugins: runJsonCommand(cliPath, ['plugins', 'list'], commandOptions),
      skills: runJsonCommand(cliPath, ['skills', 'list'], commandOptions),
      commands: runJsonCommand(cliPath, ['commands', 'list'], commandOptions),
    };
    return { cliVersion, ...validateResults(results, pluginRoot) };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const summary = smokeZcodeCli();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

module.exports = {
  EXPECTED,
  smokeZcodeCli,
  validateResults,
};
