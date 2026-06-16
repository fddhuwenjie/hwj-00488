const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  getGitRoot,
  getConfigFile,
  logSuccess,
  logError,
  logInfo,
  logWarn
} = require('./utils');

function getWorkspacesConfig() {
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) {
    return [];
  }
  try {
    const content = fs.readFileSync(configFile, 'utf8');
    const config = yaml.load(content) || {};
    return config.workspaces || [];
  } catch (e) {
    logError('读取配置文件失败: ' + e.message);
    return [];
  }
}

function saveWorkspaces(workspaces) {
  const configFile = getConfigFile();
  let config = {};
  
  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf8');
      config = yaml.load(content) || {};
    } catch (e) {
      logError('读取配置文件失败: ' + e.message);
      return false;
    }
  }

  config.workspaces = workspaces;
  fs.writeFileSync(configFile, yaml.dump(config, { indent: 2 }));
  return true;
}

function addWorkspace(workspacePath, name) {
  const gitRoot = getGitRoot();
  const absolutePath = path.resolve(workspacePath);
  
  if (!absolutePath.startsWith(gitRoot)) {
    logError('工作区路径必须在git仓库内');
    return false;
  }

  const relativePath = path.relative(gitRoot, absolutePath);

  if (!fs.existsSync(absolutePath)) {
    logWarn('路径不存在: ' + relativePath);
  }

  const workspaces = getWorkspacesConfig();
  
  if (workspaces.find(w => w.name === name)) {
    logError(`工作区 "${name}" 已存在`);
    return false;
  }

  if (workspaces.find(w => w.path === relativePath)) {
    logError(`路径 "${relativePath}" 已被注册`);
    return false;
  }

  workspaces.push({
    name,
    path: relativePath
  });

  if (saveWorkspaces(workspaces)) {
    logSuccess(`已添加工作区: ${name} (${relativePath})`);
    return true;
  }
  return false;
}

function removeWorkspace(name) {
  const workspaces = getWorkspacesConfig();
  const index = workspaces.findIndex(w => w.name === name);

  if (index === -1) {
    logError(`工作区 "${name}" 不存在`);
    return false;
  }

  workspaces.splice(index, 1);

  if (saveWorkspaces(workspaces)) {
    logSuccess(`已移除工作区: ${name}`);
    return true;
  }
  return false;
}

function listWorkspaces() {
  const workspaces = getWorkspacesConfig();

  console.log('');
  console.log('📁 工作区列表');
  console.log('='.repeat(50));

  if (workspaces.length === 0) {
    console.log('');
    logWarn('暂无工作区配置');
    console.log('');
    return;
  }

  workspaces.forEach((ws, i) => {
    console.log(`  ${i + 1}. ${ws.name}`);
    console.log(`     路径: ${ws.path}`);
    if (ws.config) {
      console.log(`     配置文件: ${ws.config}`);
    }
  });

  console.log('');
}

function resolveWorkspaceForFile(filePath) {
  const workspaces = getWorkspacesConfig();
  if (workspaces.length === 0) return null;

  let matched = null;
  let maxDepth = -1;

  for (const ws of workspaces) {
    const wsPath = ws.path.replace(/\/$/, '');
    if (filePath === wsPath || filePath.startsWith(wsPath + '/')) {
      const depth = wsPath.split('/').length;
      if (depth > maxDepth) {
        maxDepth = depth;
        matched = ws;
      }
    }
  }

  return matched;
}

function resolveWorkspacesForFiles(files) {
  const workspaceMap = new Map();
  const unmatched = [];

  for (const file of files) {
    const ws = resolveWorkspaceForFile(file);
    if (ws) {
      if (!workspaceMap.has(ws.name)) {
        workspaceMap.set(ws.name, { workspace: ws, files: [] });
      }
      workspaceMap.get(ws.name).files.push(file);
    } else {
      unmatched.push(file);
    }
  }

  return {
    workspaces: Array.from(workspaceMap.values()),
    unmatched
  };
}

function getWorkspaceConfig(workspaceName) {
  const workspaces = getWorkspacesConfig();
  const ws = workspaces.find(w => w.name === workspaceName);
  
  if (!ws) return null;

  const gitRoot = getGitRoot();
  
  if (ws.config) {
    const configPath = path.join(gitRoot, ws.path, ws.config);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        return yaml.load(content) || {};
      } catch (e) {
        logError(`读取工作区配置失败: ${e.message}`);
        return null;
      }
    }
  }

  const defaultConfigPath = path.join(gitRoot, ws.path, '.hookrc.yaml');
  if (fs.existsSync(defaultConfigPath)) {
    try {
      const content = fs.readFileSync(defaultConfigPath, 'utf8');
      return yaml.load(content) || {};
    } catch (e) {
      logError(`读取工作区配置失败: ${e.message}`);
      return null;
    }
  }

  return null;
}

function getWorkspacePipeline(workspaceName) {
  const config = getWorkspaceConfig(workspaceName);
  if (!config || !config.pipeline) return null;
  return config.pipeline;
}

module.exports = {
  getWorkspacesConfig,
  addWorkspace,
  removeWorkspace,
  listWorkspaces,
  resolveWorkspaceForFile,
  resolveWorkspacesForFiles,
  getWorkspaceConfig,
  getWorkspacePipeline
};
