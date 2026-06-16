const fs = require('fs');
const path = require('path');
const {
  GITHOOKS_DIR,
  SUPPORTED_HOOKS,
  isGitRepo,
  getGitRoot,
  getHookDir,
  ensureDir,
  logSuccess,
  logError,
  logInfo,
  execCommand,
  shouldBypass,
  recordBlock
} = require('./utils');

function getHookScriptPath(hookType) {
  return path.join(getHookDir(), hookType);
}

function getHookRegistryPath() {
  return path.join(getHookDir(), 'registry.json');
}

function readRegistry() {
  const registryPath = getHookRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { scripts: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return { scripts: {} };
  }
}

function writeRegistry(registry) {
  const registryPath = getHookRegistryPath();
  ensureDir(path.dirname(registryPath));
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function createHookTemplate(hookType) {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__dirname, '..', 'githook.js');
  return `#!/bin/sh
# Git Hook managed by githook-cli
${nodePath} "${scriptPath}" run --stage ${hookType} --hook-file "$1"
exit $?
`;
}

function init() {
  if (!isGitRepo()) {
    logError('当前目录不是Git仓库');
    process.exit(1);
  }

  const hookDir = getHookDir();
  ensureDir(hookDir);

  SUPPORTED_HOOKS.forEach(hookType => {
    const hookPath = getHookScriptPath(hookType);
    if (!fs.existsSync(hookPath)) {
      fs.writeFileSync(hookPath, createHookTemplate(hookType));
      fs.chmodSync(hookPath, '755');
    }
  });

  const result = execCommand(`git config core.hooksPath ${GITHOOKS_DIR}`);
  if (!result.success) {
    logError('配置Git hooks路径失败: ' + result.error);
    process.exit(1);
  }

  const registry = readRegistry();
  if (!registry.scripts) {
    registry.scripts = {};
  }
  writeRegistry(registry);

  logSuccess('Hook管理器已初始化');
  logInfo(`Hook目录: ${hookDir}`);
  logInfo('支持的hook类型: ' + SUPPORTED_HOOKS.join(', '));
}

function add(hookType, script) {
  if (!isGitRepo()) {
    logError('当前目录不是Git仓库');
    process.exit(1);
  }

  if (!SUPPORTED_HOOKS.includes(hookType)) {
    logError(`不支持的hook类型: ${hookType}`);
    logInfo('支持的类型: ' + SUPPORTED_HOOKS.join(', '));
    process.exit(1);
  }

  const hookDir = getHookDir();
  if (!fs.existsSync(hookDir)) {
    logWarn('尚未初始化，正在初始化...');
    init();
  }

  const registry = readRegistry();
  if (!registry.scripts[hookType]) {
    registry.scripts[hookType] = [];
  }

  const scriptId = Date.now().toString();
  registry.scripts[hookType].push({
    id: scriptId,
    script,
    createdAt: new Date().toISOString()
  });

  writeRegistry(registry);
  logSuccess(`已添加${hookType} hook: ${script}`);
  return scriptId;
}

function list() {
  if (!isGitRepo()) {
    logError('当前目录不是Git仓库');
    process.exit(1);
  }

  const registry = readRegistry();
  const scripts = registry.scripts || {};

  if (Object.keys(scripts).length === 0) {
    logInfo('暂无配置的hook脚本');
    return;
  }

  console.log('\n已配置的Git Hooks:\n');
  for (const [hookType, hookScripts] of Object.entries(scripts)) {
    if (hookScripts && hookScripts.length > 0) {
      console.log(`  ${hookType}:`);
      hookScripts.forEach((item, index) => {
        console.log(`    [${index}] ${item.script}`);
      });
      console.log('');
    }
  }
}

function remove(hookType, index) {
  if (!isGitRepo()) {
    logError('当前目录不是Git仓库');
    process.exit(1);
  }

  if (!SUPPORTED_HOOKS.includes(hookType)) {
    logError(`不支持的hook类型: ${hookType}`);
    process.exit(1);
  }

  const registry = readRegistry();
  const scripts = registry.scripts || {};

  if (!scripts[hookType] || scripts[hookType].length === 0) {
    logWarn(`${hookType} 没有配置的脚本`);
    return;
  }

  if (index === undefined) {
    delete scripts[hookType];
    writeRegistry(registry);
    logSuccess(`已移除所有${hookType} hook脚本`);
    return;
  }

  const idx = parseInt(index, 10);
  if (isNaN(idx) || idx < 0 || idx >= scripts[hookType].length) {
    logError(`无效的索引: ${index}`);
    process.exit(1);
  }

  const removed = scripts[hookType].splice(idx, 1)[0];
  if (scripts[hookType].length === 0) {
    delete scripts[hookType];
  }

  writeRegistry(registry);
  logSuccess(`已移除${hookType} hook: ${removed.script}`);
}

async function runStage(stage, hookFile) {
  if (shouldBypass()) {
    logInfo('Hook已通过 --no-verify 跳过');
    process.exit(0);
  }

  if (!isGitRepo()) {
    process.exit(0);
  }

  const registry = readRegistry();
  const scripts = (registry.scripts && registry.scripts[stage]) || [];

  if (scripts.length === 0) {
    process.exit(0);
  }

  logInfo(`执行 ${stage} hook 检查...`);
  console.log('');

  for (const item of scripts) {
    try {
      const { runCheck } = require('./checker');
      const isBuiltin = item.script.startsWith('check:');
      
      if (isBuiltin) {
        const checkName = item.script.replace('check:', '');
        const result = await runCheck(checkName, hookFile);
        if (!result.passed) {
          console.log('');
          logError(`${checkName} 检查失败: ${result.message}`);
          recordBlock(stage, `${checkName}: ${result.message}`);
          process.exit(1);
        }
        logSuccess(`${checkName} 检查通过`);
      } else {
        const result = execCommand(item.script, { stdio: 'inherit' });
        if (!result.success) {
          console.log('');
          logError(`脚本执行失败: ${item.script}`);
          recordBlock(stage, `script failed: ${item.script}`);
          process.exit(1);
        }
      }
    } catch (e) {
      console.log('');
      logError(`执行出错: ${e.message}`);
      recordBlock(stage, e.message);
      process.exit(1);
    }
  }

  console.log('');
  logSuccess('所有检查通过');
  process.exit(0);
}

module.exports = {
  init,
  add,
  list,
  remove,
  runStage,
  readRegistry,
  writeRegistry
};
