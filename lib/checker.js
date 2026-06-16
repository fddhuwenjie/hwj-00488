const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const chalk = require('chalk');
const {
  COMMIT_TYPES,
  getStagedFiles,
  getCurrentBranch,
  getGitRoot,
  getConfigFile,
  getCacheDir,
  ensureDir,
  execCommand,
  logInfo,
  logWarn
} = require('./utils');

function getConfig() {
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) {
    return { scopes: [], branchPattern: null };
  }
  try {
    const content = fs.readFileSync(configFile, 'utf8');
    return yaml.load(content) || {};
  } catch {
    return { scopes: [], branchPattern: null };
  }
}

function getFileHash(filePath) {
  const fullPath = path.join(getGitRoot(), filePath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function getCacheKey(checkName, files) {
  const fileHashes = files
    .map(f => `${f}:${getFileHash(f)}`)
    .filter(Boolean)
    .join('|');
  return crypto.createHash('md5').update(`${checkName}:${fileHashes}`).digest('hex');
}

function checkCache(checkName, files) {
  const cacheDir = getCacheDir();
  ensureDir(cacheDir);
  
  const cacheKey = getCacheKey(checkName, files);
  const cacheFile = path.join(cacheDir, `${checkName}_${cacheKey}`);
  
  return fs.existsSync(cacheFile);
}

function writeCache(checkName, files) {
  const cacheDir = getCacheDir();
  ensureDir(cacheDir);
  
  const cacheKey = getCacheKey(checkName, files);
  const cacheFile = path.join(cacheDir, `${checkName}_${cacheKey}`);
  
  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: Date.now(),
    files: files.map(f => ({ file: f, hash: getFileHash(f) }))
  }));
}

const checks = {
  'lint': async (hookFile, options = {}) => {
    const files = options.files || getStagedFiles();
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx|vue)$/.test(f));
    
    if (jsFiles.length === 0) {
      return { passed: true, message: '无需要检查的文件', cached: false };
    }

    if (checkCache('lint', jsFiles)) {
      return { passed: true, message: 'lint检查通过(缓存)', cached: true };
    }

    console.log(chalk.gray('  检查文件: ' + jsFiles.join(', ')));

    const eslintResult = execCommand(`npx --no-install eslint ${jsFiles.join(' ')} --no-error-on-unmatched-pattern 2>&1`);
    const prettierResult = execCommand(`npx --no-install prettier --check ${jsFiles.join(' ')} --no-error-on-unmatched-pattern 2>&1`);

    const errors = [];
    if (!eslintResult.success && eslintResult.output.trim()) {
      errors.push('ESLint错误:\n' + eslintResult.output);
    }
    if (!prettierResult.success && prettierResult.output.includes('Code style issues')) {
      errors.push('Prettier格式错误:\n' + prettierResult.output);
    }

    if (errors.length > 0) {
      return { passed: false, message: errors.join('\n\n'), cached: false };
    }

    writeCache('lint', jsFiles);
    return { passed: true, message: '代码规范检查通过', cached: false };
  },

  'no-console': async (hookFile, options = {}) => {
    const files = options.files || getStagedFiles();
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx|vue)$/.test(f));
    
    if (jsFiles.length === 0) {
      return { passed: true, message: '无需要检查的文件', cached: false };
    }

    if (checkCache('no-console', jsFiles)) {
      return { passed: true, message: 'no-console检查通过(缓存)', cached: true };
    }

    console.log(chalk.gray('  检查文件: ' + jsFiles.join(', ')));

    const errors = [];
    const gitRoot = getGitRoot();
    
    for (const file of jsFiles) {
      const filePath = path.join(gitRoot, file);
      if (!fs.existsSync(filePath)) continue;
      
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.includes('console.log')) {
          errors.push(`  ${file}:${index + 1}: 发现console.log`);
        }
      });
    }

    if (errors.length > 0) {
      return { passed: false, message: '检测到console.log:\n' + errors.join('\n'), cached: false };
    }

    writeCache('no-console', jsFiles);
    return { passed: true, message: '未发现console.log', cached: false };
  },

  'no-debug': async (hookFile, options = {}) => {
    const files = options.files || getStagedFiles();
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx|vue)$/.test(f));
    
    if (jsFiles.length === 0) {
      return { passed: true, message: '无需要检查的文件', cached: false };
    }

    if (checkCache('no-debug', jsFiles)) {
      return { passed: true, message: 'no-debug检查通过(缓存)', cached: true };
    }

    console.log(chalk.gray('  检查文件: ' + jsFiles.join(', ')));

    const errors = [];
    const gitRoot = getGitRoot();
    
    for (const file of jsFiles) {
      const filePath = path.join(gitRoot, file);
      if (!fs.existsSync(filePath)) continue;
      
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.trim().includes('debugger') && !line.trim().startsWith('//')) {
          errors.push(`  ${file}:${index + 1}: 发现debugger语句`);
        }
      });
    }

    if (errors.length > 0) {
      return { passed: false, message: '检测到debugger语句:\n' + errors.join('\n'), cached: false };
    }

    writeCache('no-debug', jsFiles);
    return { passed: true, message: '未发现debugger语句', cached: false };
  },

  'file-size': async (hookFile, options = {}) => {
    const files = options.files || getStagedFiles();
    const MAX_SIZE = 1 * 1024 * 1024;
    const warnings = [];
    const gitRoot = getGitRoot();

    for (const file of files) {
      const filePath = path.join(gitRoot, file);
      if (!fs.existsSync(filePath)) continue;
      
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_SIZE) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        warnings.push(`  ${file}: ${sizeMB}MB (超过1MB限制)`);
      }
    }

    if (warnings.length > 0) {
      return { passed: false, message: '大文件警告:\n' + warnings.join('\n'), cached: false };
    }

    return { passed: true, message: '所有文件大小符合要求', cached: false };
  },

  'branch-name': async () => {
    const config = getConfig();
    const branch = getCurrentBranch();
    const pattern = config.branchPattern || /^(feature|fix|hotfix|release|develop|main|master)\/.+$/.source;
    const regex = new RegExp(pattern);

    if (!regex.test(branch)) {
      return { 
        passed: false, 
        message: `分支名"${branch}"不符合规范\n  格式要求: ${pattern}\n  示例: feature/user-login, fix/bug-123`,
        cached: false 
      };
    }

    return { passed: true, message: `分支名${branch}符合规范`, cached: false };
  },

  'commit-msg': async (hookFile) => {
    const config = getConfig();
    const allowedScopes = config.scopes || [];
    
    if (!hookFile || !fs.existsSync(hookFile)) {
      return { passed: false, message: '无法读取commit消息文件', cached: false };
    }

    const message = fs.readFileSync(hookFile, 'utf8').trim();
    
    if (message.startsWith('Merge') || message.startsWith('Revert')) {
      return { passed: true, message: '合并或回退提交跳过检查', cached: false };
    }

    const regex = /^(\w+)(?:\(([\w-]+)\))?: (.+)$/;
    const match = message.match(regex);

    if (!match) {
      return {
        passed: false,
        message: `提交消息格式错误\n  消息: ${message}\n  正确格式: type(scope): description\n  支持的type: ${COMMIT_TYPES.join(', ')}`,
        cached: false
      };
    }

    const [, type, scope, description] = match;

    if (!COMMIT_TYPES.includes(type)) {
      return {
        passed: false,
        message: `不支持的type: ${type}\n  支持的type: ${COMMIT_TYPES.join(', ')}`,
        cached: false
      };
    }

    if (scope && allowedScopes.length > 0 && !allowedScopes.includes(scope)) {
      return {
        passed: false,
        message: `不支持的scope: ${scope}\n  允许的scope: ${allowedScopes.join(', ')}`,
        cached: false
      };
    }

    if (description.length < 5) {
      return {
        passed: false,
        message: '描述内容太短，至少需要5个字符',
        cached: false
      };
    }

    return { passed: true, message: `提交消息符合规范 (${type}${scope ? '(' + scope + ')' : ''}: ${description})`, cached: false };
  }
};

async function runCheck(checkName, hookFile, options = {}) {
  const check = checks[checkName];
  if (!check) {
    return { passed: false, message: `未知的检查项: ${checkName}`, cached: false };
  }

  const startTime = Date.now();
  const result = await check(hookFile, options);
  const duration = Date.now() - startTime;

  if (result.cached) {
    console.log(chalk.cyan('  [CACHED] ') + chalk.gray(`${duration}ms`));
  } else {
    console.log(chalk.gray(`  ${duration}ms`));
  }

  return result;
}

module.exports = {
  checks,
  runCheck,
  getConfig
};
