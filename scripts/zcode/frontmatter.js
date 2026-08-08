'use strict';

function stripMatchingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    if (first === '"') {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function foldBlockScalar(lines) {
  const paragraphs = [];
  let current = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n').trim();
}

function parseLeadingFrontmatter(source) {
  const normalized = String(source || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { present: false, values: {}, body: normalized };
  }

  const lines = match[1].split(/\r?\n/);
  const values = {};

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const field = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;

    const [, key, rawValue] = field;
    const value = rawValue.trim();
    if (/^[>|](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(value)) {
      const continuation = [];
      for (index += 1; index < lines.length; index += 1) {
        const nextLine = lines[index];
        if (nextLine.trim() && !/^\s/.test(nextLine)) {
          index -= 1;
          break;
        }
        continuation.push(nextLine);
      }
      values[key] = foldBlockScalar(continuation);
      continue;
    }

    values[key] = stripMatchingQuotes(value.replace(/\s+#.*$/, ''));
  }

  return {
    present: true,
    values,
    body: normalized.slice(match[0].length),
  };
}

function parseInlineList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const unwrapped = raw.startsWith('[') && raw.endsWith(']')
    ? raw.slice(1, -1)
    : raw;
  return [...new Set(unwrapped.split(',').map(stripMatchingQuotes).map(item => item.trim()).filter(Boolean))];
}

function formatScalar(key, value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (
    ['allowed-tools', 'model', 'name', 'skills'].includes(key)
    && /^[A-Za-z0-9][A-Za-z0-9 ._:@,|()/-]*$/.test(String(value))
  ) {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function formatFrontmatter(fields, body) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${formatScalar(key, value)}`);
  return `---\n${lines.join('\n')}\n---\n\n${String(body || '').replace(/^\s+/, '')}`;
}

module.exports = {
  formatFrontmatter,
  parseInlineList,
  parseLeadingFrontmatter,
  stripMatchingQuotes,
};
