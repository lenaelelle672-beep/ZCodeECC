'use strict';

const {
  formatFrontmatter,
  parseInlineList,
  parseLeadingFrontmatter,
} = require('./frontmatter');

const TEXT_REPLACEMENTS = Object.freeze([
  ['${CLAUDE_PLUGIN_ROOT}', '${ZCODE_PLUGIN_ROOT}'],
  ['${CLAUDE_PROJECT_DIR}', '${ZCODE_PROJECT_DIR}'],
  ['CLAUDE_PLUGIN_ROOT', 'ZCODE_PLUGIN_ROOT'],
  ['CLAUDE_PROJECT_DIR', 'ZCODE_PROJECT_DIR'],
  ['CLAUDE_CONFIG_DIR', 'ZCODE_CONFIG_DIR'],
  ['~/.claude', '~/.zcode'],
  ['/.claude/', '/.zcode/'],
  ['.claude/', '.zcode/'],
  ['\\.claude', '\\.zcode'],
  ['.claude', '.zcode'],
  ['CLAUDE.md', 'AGENTS.md'],
  ['Claude Code', 'ZCode'],
  ['MultiEdit', 'Edit'],
  ['Task tool', 'Agent tool'],
]);

function transformHarnessText(source) {
  let result = String(source || '');
  for (const [from, to] of TEXT_REPLACEMENTS) {
    result = result.split(from).join(to);
  }
  return result;
}

function clampDescription(value, prefix = '') {
  const normalized = `${prefix}${transformHarnessText(value)}`.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 1024) return normalized;
  return `${normalized.slice(0, 1019).trimEnd()}...`;
}

function adaptSkillMarkdown(source, fallbackName) {
  const parsed = parseLeadingFrontmatter(source);
  const name = parsed.values.name || fallbackName;
  const description = clampDescription(
    parsed.values.description || `ECC workflow skill ${fallbackName}`
  );
  return formatFrontmatter(
    { name, description },
    transformHarnessText(parsed.body)
  );
}

function adaptAgentMarkdown(source, fallbackName) {
  const parsed = parseLeadingFrontmatter(source);
  const originalName = parsed.values.name || fallbackName;
  const skillName = `ecc-agent-${originalName}`;
  const description = clampDescription(
    parsed.values.description || `ECC ${originalName} specialist`,
    `ZCode role skill adapted from the ECC ${originalName} agent. `
  );
  const originalTools = parsed.values.tools || '(not declared)';
  const originalModel = parsed.values.model || '(not declared)';
  const adaptedBody = transformHarnessText(parsed.body).trim().replace(
    /^(#{1,5})(\s+)/gm,
    (_match, hashes, spacing) => `${hashes}#${spacing}`
  );
  const body = [
    `# ${originalName} - ZCode Role Skill`,
    '',
    '> Compatibility boundary: ZCode records plugin agents but does not execute them as an independent runtime. This role skill preserves the expert workflow, but it cannot enforce the original model or tool allowlist and does not create an isolated subagent by itself.',
    '',
    `- Original agent: \`${originalName}\``,
    `- Original model preference: \`${originalModel}\``,
    `- Original tool allowlist: \`${transformHarnessText(originalTools)}\``,
    '- Run the role inline unless the active ZCode session exposes an Agent tool and the user has authorized delegation.',
    '',
    '## Adapted role instructions',
    '',
    adaptedBody,
    '',
  ].join('\n');
  return {
    skillName,
    content: formatFrontmatter({ name: skillName, description }, body),
  };
}

function normalizeAllowedTools(value) {
  return parseInlineList(value)
    .map(tool => transformHarnessText(tool).replace(/^Task$/, 'Agent'))
    .join(', ');
}

function adaptCommandMarkdown(source) {
  const parsed = parseLeadingFrontmatter(source);
  const fields = {};

  fields.description = clampDescription(
    parsed.values.description || 'Run an ECC workflow in ZCode.'
  );
  if (parsed.values['argument-hint']) {
    fields['argument-hint'] = transformHarnessText(parsed.values['argument-hint']);
  }

  const allowedTools = parsed.values['allowed-tools'] || parsed.values.allowed_tools;
  if (allowedTools) fields['allowed-tools'] = normalizeAllowedTools(allowedTools);
  if (parsed.values.model) fields.model = transformHarnessText(parsed.values.model);

  const skills = parseInlineList(parsed.values.skills);
  if (parsed.values.agent) {
    skills.push(`ecc-agent-${String(parsed.values.agent).replace(/^ecc:/, '')}`);
  }
  const normalizedSkills = [...new Set(skills.map(transformHarnessText).filter(Boolean))];
  if (normalizedSkills.length > 0) fields.skills = normalizedSkills.join(', ');

  if (parsed.values['disable-noninteractive'] === 'true' || parsed.values['disable-model-invocation'] === 'true') {
    fields['disable-noninteractive'] = true;
  }

  return formatFrontmatter(fields, transformHarnessText(parsed.body));
}

function normalizeHookMatcher(value) {
  const raw = String(value || '.*').trim();
  if (!raw || raw === '*') return '.*';
  const tokens = raw.split('|')
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => (token === 'MultiEdit' ? 'Edit' : token === 'Task' ? 'Agent' : token));
  return [...new Set(tokens)].join('|') || '.*';
}

module.exports = {
  adaptAgentMarkdown,
  adaptCommandMarkdown,
  adaptSkillMarkdown,
  clampDescription,
  normalizeHookMatcher,
  transformHarnessText,
};
