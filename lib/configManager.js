const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');
const {
  CONFIG_FILE,
  SUPPORTED_HOOKS,
  isGitRepo,
  getGitRoot,
  getConfigFile,
  getHookDir,
  ensureDir,
  logSuccess,
  logError,
  logInfo,
  logWarn,
  execCommand
} = require('./utils');
const { add, init, readRegistry, writeRegistry } = require('./hookManager');
const { getStatsFromHistory } = require('./history');

function loadConfig() {
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configFile, 'utf8');
    return yaml.load(content) || {};
  } catch (e) {
    logError('解析配置文件失败: ' + e.message);
    return null;
  }
}

function saveConfig(config) {
  const configFile = getConfigFile();
  ensureDir(path.dirname(configFile));
  fs.writeFileSync(configFile, yaml.dump(config, { indent: 2 }));
}

async function setup() {
  if (!isGitRepo()) {
    logError('当前目录不是Git仓库');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    logError('未找到 .hookrc.yaml 配置文件');
    process.exit(1);
  }

  const hookDir = getHookDir();
  if (!fs.existsSync(hookDir)) {
    logInfo('正在初始化Hook管理器...');
    init();
  }

  const registry = readRegistry();
  registry.scripts = {};

  if (config.hooks) {
    for (const [hookType, scripts] of Object.entries(config.hooks)) {
      if (!SUPPORTED_HOOKS.includes(hookType)) {
        logWarn(`忽略不支持的hook类型: ${hookType}`);
        continue;
      }

      if (!registry.scripts[hookType]) {
        registry.scripts[hookType] = [];
      }

      const scriptList = Array.isArray(scripts) ? scripts : [scripts];
      
      for (const script of scriptList) {
        let scriptStr = script;
        let when = null;
        let checkName = null;
        
        if (typeof script === 'object') {
          if (script.check) {
            scriptStr = `check:${script.check}`;
            checkName = script.check;
          } else if (script.script) {
            scriptStr = script.script;
          }
          if (script.when) {
            when = script.when;
          }
        }
        
        registry.scripts[hookType].push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          script: scriptStr,
          checkName,
          when,
          createdAt: new Date().toISOString()
        });
        
        let desc = scriptStr;
        if (when) {
          desc += ' (有条件)';
        }
        logSuccess(`已配置 ${hookType}: ${desc}`);
      }
    }
  }

  writeRegistry(registry);

  if (config.scopes) {
    logInfo(`已配置允许的scopes: ${config.scopes.join(', ')}`);
  }

  if (config.branchPattern) {
    logInfo(`已配置分支名格式: ${config.branchPattern}`);
  }

  console.log('');
  logSuccess('配置已完成，所有hook已安装');
}

function showStats() {
  const stats = getStatsFromHistory();
  const now = new Date();
  const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  
  console.log('');
  console.log(chalk.bold(`📊 ${monthStr} Hook执行统计`));
  console.log(chalk.gray('='.repeat(50)));
  console.log(`  总执行次数: ${chalk.bold(stats.total)}`);
  console.log(`  通过: ${chalk.green.bold(stats.passed)}  |  失败: ${chalk.red.bold(stats.failed)}`);
  console.log(`  通过率: ${chalk.bold(stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) + '%' : 'N/A')}`);
  console.log('');

  if (Object.keys(stats.byHookType).length > 0) {
    console.log(chalk.gray('  按Hook类型分布:'));
    for (const [hookType, data] of Object.entries(stats.byHookType)) {
      console.log(`    ${hookType.padEnd(14)} 通过: ${String(data.pass).padEnd(4)} 失败: ${String(data.fail).padEnd(4)}`);
    }
    console.log('');
  }
  
  if (stats.recentFailures && stats.recentFailures.length > 0) {
    console.log(chalk.gray('  最近的失败记录:'));
    stats.recentFailures.forEach((record, i) => {
      const time = new Date(record.timestamp).toLocaleString();
      console.log(`  ${i + 1}. [${record.hookType}] ${record.checkName}`);
      console.log(`     ${chalk.gray(time)}`);
      console.log(`     ${chalk.red(record.reason.substring(0, 50))}${record.reason.length > 50 ? '...' : ''}`);
    });
  } else {
    console.log(chalk.gray('  本月暂无失败记录 🎉'));
  }
  console.log('');
}

function createExampleConfig() {
  const config = {
    scopes: ['auth', 'user', 'order', 'payment', 'common', 'api'],
    branchPattern: '^(feature|fix|hotfix|release|develop|main|master)/.+$',
    workspaces: [
      { name: 'frontend', path: 'apps/frontend' },
      { name: 'backend', path: 'apps/backend' }
    ],
    hooks: {
      'pre-commit': [
        { check: 'branch-name' },
        {
          check: 'no-console',
          when: {
            files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx']
          }
        },
        {
          check: 'no-debug',
          when: {
            files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx']
          }
        },
        { check: 'file-size' }
      ],
      'commit-msg': [
        { check: 'commit-msg' }
      ]
    },
    pipeline: {
      name: 'CI Pipeline',
      stages: [
        {
          name: 'Install Dependencies',
          steps: [
            {
              name: 'npm install',
              command: 'npm install',
              dependencies: ['package.json', 'package-lock.json'],
              cache: true
            }
          ]
        },
        {
          name: 'Code Quality',
          parallel: true,
          steps: [
            {
              name: 'ESLint Check',
              command: 'npx eslint . --ext .js,.jsx,.ts,.tsx',
              dependencies: ['src'],
              cache: true
            },
            {
              name: 'Prettier Check',
              command: 'npx prettier --check "src/**/*.{js,jsx,ts,tsx}"',
              dependencies: ['src'],
              cache: true
            }
          ]
        },
        {
          name: 'Test & Build',
          steps: [
            {
              name: 'Run Tests',
              command: 'npm test',
              dependencies: ['src', 'tests'],
              cache: false
            },
            {
              name: 'Build Project',
              command: 'npm run build',
              dependencies: ['src'],
              cache: true
            }
          ]
        }
      ]
    }
  };

  return config;
}

function initConfig() {
  const configFile = getConfigFile();
  if (fs.existsSync(configFile)) {
    logWarn('.hookrc.yaml 已存在');
    return;
  }

  const config = createExampleConfig();
  saveConfig(config);
  logSuccess('已创建示例配置文件 .hookrc.yaml');
  logInfo('包含 3个pre-commit检查 + 1个commit-msg检查 + 1个3步流水线');
}

module.exports = {
  loadConfig,
  saveConfig,
  setup,
  showStats,
  createExampleConfig,
  initConfig
};
