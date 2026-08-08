const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

function listGeneratedSkillDirectories(repoRoot, prefix) {
  const skillsRoot = path.join(repoRoot || '', '.zcode', 'skills');
  if (!repoRoot || !fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => entry.name)
    .sort();
}

function planZcodeOperations(input, adapter) {
  const repoRoot = input.repoRoot;
  if (!repoRoot) throw new Error('repoRoot is required to plan ZCode operations');
  const targetRoot = adapter.resolveRoot(input);
  const operations = [];
  const seen = new Set();

  function add(moduleId, sourceRelativePath, destinationRelativePath, strategy = 'preserve-relative-path') {
    const normalizedSource = normalizeRelativePath(sourceRelativePath);
    const sourcePath = path.join(repoRoot, normalizedSource);
    if (!fs.existsSync(sourcePath)) return;
    const destinationPath = path.join(targetRoot, destinationRelativePath);
    const key = `${normalizedSource}\0${destinationPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    operations.push(createManagedOperation({
      moduleId,
      sourceRelativePath: normalizedSource,
      destinationPath,
      strategy,
    }));
  }

  for (const module of input.modules || []) {
    if (module.id === 'agents-core') {
      for (const skillName of listGeneratedSkillDirectories(repoRoot, 'ecc-agent-')) {
        add(module.id, path.join('.zcode', 'skills', skillName), path.join('skills', skillName));
      }
    }

    if (module.id === 'rules-core') {
      for (const skillName of listGeneratedSkillDirectories(repoRoot, 'ecc-rules-')) {
        add(module.id, path.join('.zcode', 'skills', skillName), path.join('skills', skillName));
      }
    }

    if (module.id === 'commands-core') {
      add(module.id, path.join('.zcode', 'commands'), 'commands', 'sync-root-children');
    }

    if (module.id === 'platform-configs') {
      add(module.id, path.join('.zcode', 'README.md'), path.join('ecc', 'README.md'));
      add(
        module.id,
        path.join('.zcode', 'compatibility-manifest.json'),
        path.join('ecc', 'compatibility-manifest.json')
      );
      add(module.id, path.join('.zcode', 'mcp'), path.join('ecc', 'mcp'));
      add(module.id, path.join('scripts', 'lib'), path.join('scripts', 'lib'));
      add(module.id, path.join('scripts', 'zcode'), path.join('scripts', 'zcode'));
    }

    for (const sourceRelativePath of module.paths || []) {
      const normalizedSource = normalizeRelativePath(sourceRelativePath);
      if (normalizedSource.startsWith('skills/')) {
        const skillName = normalizedSource.slice('skills/'.length);
        add(
          module.id,
          path.join('.zcode', 'skills', skillName),
          path.join('skills', skillName)
        );
      } else if (normalizedSource.startsWith('scripts/')) {
        add(module.id, normalizedSource, normalizedSource);
      } else if (normalizedSource.endsWith('.md') && !isForeignPlatformPath(normalizedSource, 'zcode')) {
        add(module.id, normalizedSource, path.join('ecc', 'docs', path.basename(normalizedSource)));
      }
    }
  }

  return operations;
}

module.exports = createInstallTargetAdapter({
  id: 'zcode-home',
  target: 'zcode',
  kind: 'home',
  rootSegments: ['.zcode'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.zcode',
  planOperations: planZcodeOperations,
});
