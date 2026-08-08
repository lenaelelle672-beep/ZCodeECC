#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOP_LEVEL_OUTPUT_FIELDS = Object.freeze([
  'additionalContext',
  'additional_context',
  'continue',
  'decision',
  'reason',
  'stopReason',
  'suppressOutput',
  'systemMessage',
]);

const EVENT_OUTPUT_FIELDS = Object.freeze({
  PreToolUse: ['additionalContext', 'permissionDecision', 'permissionDecisionReason', 'updatedInput'],
  PermissionRequest: ['decision'],
  UserPromptSubmit: ['additionalContext'],
  SessionStart: ['additionalContext'],
  PostToolUse: ['additionalContext'],
  PostToolUseFailure: ['additionalContext'],
  Stop: ['additionalContext'],
});

function resolvePluginRoot() {
  return path.resolve(
    process.env.ZCODE_PLUGIN_ROOT
      || process.env.CLAUDE_PLUGIN_ROOT
      || path.join(__dirname, '../..')
  );
}

function readCanonicalHooks(pluginRoot) {
  const bundledPath = path.join(pluginRoot, 'runtime', 'canonical-hooks.json');
  const hooksPath = fs.existsSync(bundledPath)
    ? bundledPath
    : path.join(pluginRoot, 'hooks', 'hooks.json');
  return JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks;
}

function resolveAgentDataHome(env = process.env) {
  if (env.ECC_AGENT_DATA_HOME && env.ECC_AGENT_DATA_HOME.trim()) {
    return env.ECC_AGENT_DATA_HOME.trim();
  }
  const homeDir = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(homeDir, '.zcode', 'ecc-data');
}

function findHookGroup(hooks, sourceEvent, groupId) {
  const groups = hooks[sourceEvent] || [];
  return groups.find(group => group.id === groupId) || null;
}

function copyKnownFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

function sanitizeHookOutput(stdout, targetEvent, rawInput = '') {
  const text = String(stdout || '').trim();
  if (!text || text === String(rawInput || '').trim() || !text.startsWith('{')) return '';

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';

  const sanitized = copyKnownFields(parsed, TOP_LEVEL_OUTPUT_FIELDS);
  if (sanitized.decision && !['approve', 'block'].includes(sanitized.decision)) {
    delete sanitized.decision;
  }

  if (parsed.hookSpecificOutput && EVENT_OUTPUT_FIELDS[targetEvent]) {
    const eventOutput = copyKnownFields(
      parsed.hookSpecificOutput,
      EVENT_OUTPUT_FIELDS[targetEvent]
    );
    sanitized.hookSpecificOutput = {
      hookEventName: targetEvent,
      ...eventOutput,
    };
  }

  return Object.keys(sanitized).length > 0
    ? `${JSON.stringify(sanitized)}\n`
    : '';
}

function runHookCommand(commandConfig, rawInput, pluginRoot, targetEvent = '') {
  const timeoutMs = commandConfig.timeoutMs
    || (commandConfig.timeout ? commandConfig.timeout * 1000 : 60000);
  const result = spawnSync(commandConfig.command, {
    shell: commandConfig.shell || true,
    input: rawInput,
    encoding: 'utf8',
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ZCODE_PLUGIN_ROOT: pluginRoot,
      ECC_PLUGIN_ROOT: pluginRoot,
      ECC_AGENT_DATA_HOME: resolveAgentDataHome(),
      CLAUDE_HOOK_EVENT_NAME: targetEvent,
      ZCODE_HOOK_EVENT_NAME: targetEvent,
    },
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  return result;
}

function main() {
  const [, , sourceEvent, groupId, targetEvent = sourceEvent] = process.argv;
  const rawInput = fs.readFileSync(0, 'utf8');
  const pluginRoot = resolvePluginRoot();
  let group;

  try {
    group = findHookGroup(readCanonicalHooks(pluginRoot), sourceEvent, groupId);
  } catch (error) {
    process.stderr.write(`[ZCodeECC] Unable to load hook ${sourceEvent}/${groupId}: ${error.message}\n`);
    process.exit(1);
  }

  if (!group) {
    process.stderr.write(`[ZCodeECC] Unknown hook ${sourceEvent}/${groupId}\n`);
    process.exit(1);
  }

  for (const hook of group.hooks || []) {
    if (hook.type !== 'command' || typeof hook.command !== 'string') {
      process.stderr.write(`[ZCodeECC] Unsupported source hook type for ${sourceEvent}/${groupId}\n`);
      process.exit(1);
    }

    const result = runHookCommand(hook, rawInput, pluginRoot, targetEvent);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.signal || result.status === null) {
      const reason = result.error?.message || result.signal || 'missing exit status';
      process.stderr.write(`[ZCodeECC] Hook bridge failed: ${reason}\n`);
      process.exit(1);
    }
    if (result.status !== 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      process.exit(result.status);
    }

    const sanitized = sanitizeHookOutput(result.stdout, targetEvent, rawInput);
    if (sanitized) process.stdout.write(sanitized);
  }
}

if (require.main === module) main();

module.exports = {
  findHookGroup,
  readCanonicalHooks,
  resolveAgentDataHome,
  runHookCommand,
  sanitizeHookOutput,
};
