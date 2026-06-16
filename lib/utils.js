const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');

const GITHOOKS_DIR = '.githooks';
const CONFIG_FILE = '.hookrc.yaml';
const STATS_FILE = path.join(GITHOOKS_DIR, 'stats.json');
const CACHE_DIR = path.join(GITHOOKS_DIR, 'cache');

const SUPPORTED_HOOKS = ['pre-commit', 'commit-msg', 'pre-push', 'post-merge'];
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function getHookDir() {
  return path.join(getGitRoot(), GITHOOKS_DIR);
}

function getStatsFile() {
  return path.join(getGitRoot(), STATS_FILE);
}

function getCacheDir() {
  return path.join(getGitRoot(), CACHE_DIR);
}

function getConfigFile() {
  return path.join(getGitRoot(), CONFIG_FILE);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function logSuccess(msg) {
  console.log(chalk.green('✓ ' + msg));
}

function logError(msg) {
  console.error(chalk.red('✗ ' + msg));
}

function logInfo(msg) {
  console.log(chalk.blue('ℹ ' + msg));
}

function logWarn(msg) {
  console.log(chalk.yellow('⚠ ' + msg));
}

function formatTime(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function execCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      cwd: getGitRoot(),
      ...options
    });
    return { success: true, output: result };
  } catch (e) {
    return { success: false, output: e.stdout || '', error: e.stderr || e.message };
  }
}

function readStats() {
  const statsFile = getStatsFile();
  if (!fs.existsSync(statsFile)) {
    return { blocks: {}, totalBlocks: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch {
    return { blocks: {}, totalBlocks: 0 };
  }
}

function writeStats(stats) {
  const statsFile = getStatsFile();
  ensureDir(path.dirname(statsFile));
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

function recordBlock(hookType, reason) {
  const stats = readStats();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  if (!stats.blocks[monthKey]) {
    stats.blocks[monthKey] = { count: 0, details: [] };
  }
  
  stats.blocks[monthKey].count++;
  stats.blocks[monthKey].details.push({
    hook: hookType,
    reason,
    timestamp: now.toISOString()
  });
  stats.totalBlocks++;
  
  writeStats(stats);
}

function getMonthlyStats() {
  const stats = readStats();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return stats.blocks[monthKey] || { count: 0, details: [] };
}

function getStagedFiles() {
  const result = execCommand('git diff --cached --name-only --diff-filter=ACM');
  if (!result.success) return [];
  return result.output.trim().split('\n').filter(f => f);
}

function getCurrentBranch() {
  const result = execCommand('git rev-parse --abbrev-ref HEAD');
  if (!result.success) return '';
  return result.output.trim();
}

function shouldBypass() {
  return process.env.GITHOOK_BYPASS === '1' || 
         process.argv.includes('--no-verify') ||
         process.argv.includes('--no-githook');
}

module.exports = {
  GITHOOKS_DIR,
  CONFIG_FILE,
  SUPPORTED_HOOKS,
  COMMIT_TYPES,
  isGitRepo,
  getGitRoot,
  getHookDir,
  getStatsFile,
  getCacheDir,
  getConfigFile,
  ensureDir,
  logSuccess,
  logError,
  logInfo,
  logWarn,
  formatTime,
  execCommand,
  readStats,
  writeStats,
  recordBlock,
  getMonthlyStats,
  getStagedFiles,
  getCurrentBranch,
  shouldBypass
};
