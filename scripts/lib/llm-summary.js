#!/usr/bin/env node
/**
 * LLM-powered session summary generator
 *
 * Uses the active harness CLI to generate rich, contextual session summaries
 * from JSONL transcripts. Claude receives the prompt on stdin. ZCode receives
 * a mode-0600 temporary attachment so conversation text is not exposed in the
 * process argument list.
 *
 * Recursion guard: sets ECC_SKIP_LLM_SUMMARY=1 in subprocess env so any Stop
 * hooks fired by the subprocess do NOT re-enter LLM summarization.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_TRANSCRIPT_CHARS = 7000;
const MAX_TURNS = 25;
const LLM_TIMEOUT_MS = 90000;
const DEFAULT_ZCODE_CLI = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';

function getLLMModel(env = process.env) {
  return env.ECC_LLM_SUMMARY_MODEL || 'haiku';
}

function isZcodeRuntime(env = process.env) {
  return String(env.ECC_HARNESS || '').toLowerCase() === 'zcode'
    || Boolean(env.ZCODE_PLUGIN_ROOT)
    || Boolean(env.ZCODE_HOOK_EVENT_NAME);
}

function resolveSummaryInvocation(options = {}) {
  const env = options.env || process.env;
  if (!isZcodeRuntime(env)) {
    return {
      command: 'claude',
      args: ['--model', getLLMModel(env), '-p'],
      input: options.prompt || '',
      harness: 'claude',
    };
  }

  if (!options.promptFile) {
    throw new Error('ZCode summary invocation requires a private prompt attachment');
  }
  const existsSync = options.existsSync || fs.existsSync;
  const configuredCli = env.ECC_ZCODE_CLI || env.ZCODE_CLI;
  const cliPath = configuredCli
    || (existsSync(DEFAULT_ZCODE_CLI) ? DEFAULT_ZCODE_CLI : 'zcode');
  const scriptCli = /\.(?:cjs|mjs|js)$/i.test(cliPath);
  return {
    command: scriptCli ? (options.execPath || process.execPath) : cliPath,
    args: [
      ...(scriptCli ? [cliPath] : []),
      '--prompt',
      'Summarize the attached session-summary-input.md exactly as instructed in that file.',
      '--attach',
      options.promptFile,
      '--mode',
      'plan',
      '--max-turns',
      '1',
      '--no-color',
    ],
    input: undefined,
    harness: 'zcode',
  };
}

function getContextThreshold() {
  const raw = parseInt(process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD || '20', 10);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 20;
}

/**
 * Extract the last MAX_TURNS user+assistant turns from a JSONL transcript.
 * Returns null when the transcript is missing or has no parseable turns.
 */
function extractConversationText(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n').filter(Boolean);
  const turns = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const isUser = entry.type === 'user' || entry.message?.role === 'user';
      const isAssistant = entry.type === 'assistant';

      if (isUser) {
        const rawContent = entry.message?.content ?? entry.content;
        const text =
          typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .filter(c => c?.type === 'text')
                  .map(c => c.text)
                  .join(' ')
              : '';
        const cleaned = text.replace(/\n+/g, ' ').trim();
        if (cleaned) {
          turns.push({ role: 'User', text: cleaned.slice(0, 400) });
        }
      }

      if (isAssistant && Array.isArray(entry.message?.content)) {
        const textParts = entry.message.content
          .filter(b => b?.type === 'text')
          .map(b => b.text)
          .join(' ')
          .replace(/\n+/g, ' ')
          .trim();
        if (textParts) {
          turns.push({ role: 'Assistant', text: textParts.slice(0, 600) });
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  if (turns.length === 0) return null;

  const recent = turns.slice(-MAX_TURNS);
  const formatted = recent.map(t => `**${t.role}:** ${t.text}`).join('\n\n');
  return formatted.length > MAX_TRANSCRIPT_CHARS ? '...(前略)\n\n' + formatted.slice(-MAX_TRANSCRIPT_CHARS) : formatted;
}

/**
 * Read the context remaining percentage from a transcript's latest usage record.
 * Returns null when unavailable.
 */
function getContextRemainingPct(transcriptPath) {
  try {
    const { readLatestContextTokens, resolveContextWindowTokens } = require('./transcript-context');
    const usage = readLatestContextTokens(transcriptPath);
    if (!usage) return null;
    const windowTokens = resolveContextWindowTokens(usage.tokens, usage.model);
    return Math.round((1 - usage.tokens / windowTokens) * 100);
  } catch {
    return null;
  }
}

/**
 * Generate a session summary using the active harness CLI.
 * Returns the summary string, or null on failure or when recursion guard is active.
 */
function generateSessionSummary(transcriptPath, options = {}) {
  const env = options.env || process.env;
  if (env.ECC_SKIP_LLM_SUMMARY) return null;

  const conversation = extractConversationText(transcriptPath);
  if (!conversation) return null;

  const prompt = [
    'Below is a conversation log from a coding-agent session.',
    'Create a summary to help the next session quickly understand the context.',
    '',
    '## Prioritize including',
    '- Design decisions and technology choices made this session',
    '- Bugs and problems solved',
    '- Files changed or created, with a brief description of changes',
    '- Unfinished tasks and work to continue in the next session',
    '- Important context the next session needs to know',
    '',
    '## Conversation log',
    conversation,
    '',
    '## Output format (Markdown only, no preamble)',
    '',
    '## Session Summary',
    '',
    '### Tasks',
    '(main tasks worked on this session)',
    '',
    '### Decisions Made',
    '(design decisions and technology choices)',
    '',
    '### Files Modified',
    '(files changed or created)',
    '',
    '### Unresolved Issues',
    '(unfinished tasks and work to continue)',
    '',
    '### Next Session Context',
    '(important context for the next session)'
  ].join('\n');

  let temporaryRoot = null;
  try {
    let promptFile = null;
    if (isZcodeRuntime(env)) {
      temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-zcode-summary-'));
      promptFile = path.join(temporaryRoot, 'session-summary-input.md');
      fs.writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });
      fs.chmodSync(promptFile, 0o600);
    }
    const invocation = resolveSummaryInvocation({
      env,
      prompt,
      promptFile,
      existsSync: options.existsSync,
      execPath: options.execPath,
    });
    const spawn = options.spawnSync || spawnSync;
    const result = spawn(invocation.command, invocation.args, {
      input: invocation.input,
      encoding: 'utf8',
      env: {
        ...env,
        CLAUDECODE: '',
        ECC_SKIP_LLM_SUMMARY: '1'
      },
      timeout: LLM_TIMEOUT_MS,
      shell: process.platform === 'win32'
    });

    if (result.error || result.status !== 0) {
      return null;
    }

    const output = (result.stdout || '').trim();
    return output || null;
  } catch {
    return null;
  } finally {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = {
  extractConversationText,
  generateSessionSummary,
  getContextRemainingPct,
  getContextThreshold,
  getLLMModel,
  isZcodeRuntime,
  resolveSummaryInvocation,
};
