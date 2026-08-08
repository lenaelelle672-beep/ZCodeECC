const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

const ZCODE_RUNTIME_ROOT_SCRIPTS = Object.freeze([
  'auto-update.js',
  'github-coordination.js',
  'harness-audit.js',
  'install-apply.js',
  'install-plan.js',
  'orchestrate-worktrees.js',
  'plan-canvas.js',
  'setup-package-manager.js',
  'skills-health.js',
]);

function resolveProjectionPaths(repoRoot) {
  if (fs.existsSync(path.join(repoRoot, '.zcode', 'skills'))) {
    return {
      skills: path.join('.zcode', 'skills'),
      commands: path.join('.zcode', 'commands'),
      metadata: '.zcode',
    };
  }
  if (fs.existsSync(path.join(repoRoot, '.zcode-plugin', 'plugin.json'))) {
    return { skills: 'skills', commands: 'commands', metadata: '.' };
  }
  if (fs.existsSync(path.join(repoRoot, 'ecc', 'compatibility-manifest.json'))) {
    return { skills: 'skills', commands: 'commands', metadata: 'ecc' };
  }
  return {
    skills: path.join('.zcode', 'skills'),
    commands: path.join('.zcode', 'commands'),
    metadata: '.zcode',
  };
}

function listGeneratedSkillDirectories(repoRoot, projection, prefix) {
  const skillsRoot = path.join(repoRoot || '', projection.skills);
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
  const includesRuntimeBundle = (input.modules || []).some(module => module.id === 'platform-configs');
  const projection = resolveProjectionPaths(repoRoot);

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
      for (const skillName of listGeneratedSkillDirectories(repoRoot, projection, 'ecc-agent-')) {
        add(module.id, path.join(projection.skills, skillName), path.join('skills', skillName));
      }
    }

    if (module.id === 'rules-core') {
      for (const skillName of listGeneratedSkillDirectories(repoRoot, projection, 'ecc-rules-')) {
        add(module.id, path.join(projection.skills, skillName), path.join('skills', skillName));
      }
    }

    if (module.id === 'commands-core') {
      add(module.id, projection.commands, 'commands', 'sync-root-children');
    }

    if (module.id === 'platform-configs') {
      add(module.id, path.join(projection.metadata, 'README.md'), path.join('ecc', 'README.md'));
      add(
        module.id,
        path.join(projection.metadata, 'compatibility-manifest.json'),
        path.join('ecc', 'compatibility-manifest.json')
      );
      add(module.id, path.join(projection.metadata, 'mcp'), path.join('ecc', 'mcp'));
      add(module.id, 'config', 'config');
      add(module.id, 'manifests', 'manifests');
      add(module.id, 'schemas', 'schemas');
      add(module.id, 'package.json', 'package.json');
      add(module.id, 'VERSION', 'VERSION');
      add(module.id, path.join('scripts', 'lib'), path.join('scripts', 'lib'));
      for (const scriptName of ZCODE_RUNTIME_ROOT_SCRIPTS) {
        add(module.id, path.join('scripts', scriptName), path.join('scripts', scriptName));
      }
    }

    for (const sourceRelativePath of module.paths || []) {
      const normalizedSource = normalizeRelativePath(sourceRelativePath);
      if (normalizedSource.startsWith('skills/')) {
        const skillName = normalizedSource.slice('skills/'.length);
        add(
          module.id,
          path.join(projection.skills, skillName),
          path.join('skills', skillName)
        );
      } else if (normalizedSource.startsWith('scripts/')) {
        if (includesRuntimeBundle) continue;
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
