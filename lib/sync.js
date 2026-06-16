const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');
const {
  getGitRoot,
  getConfigFile,
  ensureDir,
  logSuccess,
  logError,
  logInfo,
  logWarn
} = require('./utils');

function fetchRemoteConfig(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          fetchRemoteConfig(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`请求失败: HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const config = yaml.load(data);
          resolve(config);
        } catch (e) {
          reject(new Error('解析远程配置失败: ' + e.message));
        }
      });
    }).on('error', (e) => {
      reject(new Error('网络请求失败: ' + e.message));
    });
  });
}

function loadLocalConfig() {
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configFile, 'utf8');
    return yaml.load(content) || {};
  } catch (e) {
    logError('读取本地配置失败: ' + e.message);
    return null;
  }
}

function saveConfig(config) {
  const configFile = getConfigFile();
  ensureDir(path.dirname(configFile));
  fs.writeFileSync(configFile, yaml.dump(config, { indent: 2 }));
}

function mergeConfigs(localConfig, remoteConfig) {
  const merged = { ...localConfig };

  for (const [key, remoteValue] of Object.entries(remoteConfig)) {
    if (key === 'hooks' && Array.isArray(remoteValue) === false && typeof remoteValue === 'object') {
      if (!merged.hooks) merged.hooks = {};
      for (const [hookType, hookScripts] of Object.entries(remoteValue)) {
        if (!merged.hooks[hookType]) {
          merged.hooks[hookType] = [...hookScripts];
        } else {
          const existing = merged.hooks[hookType];
          for (const script of hookScripts) {
            const scriptStr = typeof script === 'object'
              ? (script.check ? `check:${script.check}` : script.script || '')
              : script;
            const exists = existing.some(s => {
              const sStr = typeof s === 'object'
                ? (s.check ? `check:${s.check}` : s.script || '')
                : s;
              return sStr === scriptStr;
            });
            if (!exists) {
              existing.push(script);
            }
          }
        }
      }
    } else if (Array.isArray(remoteValue)) {
      if (!merged[key]) {
        merged[key] = [...remoteValue];
      } else {
        for (const item of remoteValue) {
          const itemStr = JSON.stringify(item);
          const exists = merged[key].some(i => JSON.stringify(i) === itemStr);
          if (!exists) {
            merged[key].push(item);
          }
        }
      }
    } else if (typeof remoteValue === 'object' && remoteValue !== null) {
      if (!merged[key] || typeof merged[key] !== 'object') {
        merged[key] = { ...remoteValue };
      } else {
        merged[key] = { ...merged[key], ...remoteValue };
      }
    } else {
      merged[key] = remoteValue;
    }
  }

  return merged;
}

async function syncRemoteConfig(url, options = {}) {
  try {
    logInfo(`正在从 ${url} 拉取配置...`);
    const remoteConfig = await fetchRemoteConfig(url);

    if (!remoteConfig || typeof remoteConfig !== 'object') {
      logError('远程配置无效');
      return false;
    }

    const localConfig = loadLocalConfig() || {};

    if (options.merge) {
      const merged = mergeConfigs(localConfig, remoteConfig);
      saveConfig(merged);
      logSuccess('配置合并完成');
    } else {
      saveConfig(remoteConfig);
      logSuccess('配置已覆盖更新');
    }

    return true;
  } catch (e) {
    logError('同步失败: ' + e.message);
    return false;
  }
}

function deepDiff(obj1, obj2, path = '') {
  const diffs = [];

  const allKeys = new Set([
    ...Object.keys(obj1 || {}),
    ...Object.keys(obj2 || {})
  ]);

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1 ? obj1[key] : undefined;
    const val2 = obj2 ? obj2[key] : undefined;

    if (val1 === undefined && val2 !== undefined) {
      diffs.push({ type: 'added', path: currentPath, newValue: val2 });
    } else if (val1 !== undefined && val2 === undefined) {
      diffs.push({ type: 'removed', path: currentPath, oldValue: val1 });
    } else if (typeof val1 === 'object' && typeof val2 === 'object' && val1 !== null && val2 !== null) {
      if (Array.isArray(val1) && Array.isArray(val2)) {
        const arrDiff = compareArrays(val1, val2, currentPath);
        diffs.push(...arrDiff);
      } else if (!Array.isArray(val1) && !Array.isArray(val2)) {
        diffs.push(...deepDiff(val1, val2, currentPath));
      } else {
        diffs.push({ type: 'modified', path: currentPath, oldValue: val1, newValue: val2 });
      }
    } else if (val1 !== val2) {
      diffs.push({ type: 'modified', path: currentPath, oldValue: val1, newValue: val2 });
    }
  }

  return diffs;
}

function compareArrays(arr1, arr2, path) {
  const diffs = [];
  const str1 = arr1.map(i => JSON.stringify(i));
  const str2 = arr2.map(i => JSON.stringify(i));

  const added = arr2.filter((item, i) => !str1.includes(str2[i]));
  const removed = arr1.filter((item, i) => !str2.includes(str1[i]));

  if (added.length > 0) {
    diffs.push({ type: 'added', path: `${path}[]`, newValue: added });
  }
  if (removed.length > 0) {
    diffs.push({ type: 'removed', path: `${path}[]`, oldValue: removed });
  }

  return diffs;
}

async function diffConfig(source) {
  let remoteConfig;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    try {
      logInfo(`正在从 ${source} 拉取配置...`);
      remoteConfig = await fetchRemoteConfig(source);
    } catch (e) {
      logError('获取远程配置失败: ' + e.message);
      return false;
    }
  } else {
    const { getTemplate } = require('./templates');
    const template = getTemplate(source);
    if (!template) {
      logError(`未找到模板: ${source}`);
      return false;
    }
    remoteConfig = template.config;
  }

  const localConfig = loadLocalConfig() || {};
  const diffs = deepDiff(localConfig, remoteConfig);

  console.log('');
  console.log(chalk.bold('📋 配置差异对比'));
  console.log(chalk.gray('='.repeat(50)));

  if (diffs.length === 0) {
    console.log(chalk.green('  配置完全一致 ✓'));
    console.log('');
    return true;
  }

  let added = 0, removed = 0, modified = 0;

  for (const diff of diffs) {
    switch (diff.type) {
      case 'added':
        added++;
        console.log(`  ${chalk.green('+')} ${diff.path}`);
        if (Array.isArray(diff.newValue) && diff.path.endsWith('[]')) {
          diff.newValue.forEach(item => {
            const desc = typeof item === 'object'
              ? (item.check ? `check:${item.check}` : item.name || JSON.stringify(item))
              : item;
            console.log(`      ${chalk.green('+')} ${desc}`);
          });
        } else if (typeof diff.newValue === 'object') {
          console.log(`      ${chalk.green(JSON.stringify(diff.newValue))}`);
        } else {
          console.log(`      ${chalk.green(diff.newValue)}`);
        }
        break;
      case 'removed':
        removed++;
        console.log(`  ${chalk.red('-')} ${diff.path}`);
        if (Array.isArray(diff.oldValue) && diff.path.endsWith('[]')) {
          diff.oldValue.forEach(item => {
            const desc = typeof item === 'object'
              ? (item.check ? `check:${item.check}` : item.name || JSON.stringify(item))
              : item;
            console.log(`      ${chalk.red('-')} ${desc}`);
          });
        } else if (typeof diff.oldValue === 'object') {
          console.log(`      ${chalk.red(JSON.stringify(diff.oldValue))}`);
        } else {
          console.log(`      ${chalk.red(diff.oldValue)}`);
        }
        break;
      case 'modified':
        modified++;
        console.log(`  ${chalk.yellow('~')} ${diff.path}`);
        const oldStr = typeof diff.oldValue === 'object' ? JSON.stringify(diff.oldValue) : diff.oldValue;
        const newStr = typeof diff.newValue === 'object' ? JSON.stringify(diff.newValue) : diff.newValue;
        console.log(`    ${chalk.red('-')} ${oldStr}`);
        console.log(`    ${chalk.green('+')} ${newStr}`);
        break;
    }
  }

  console.log('');
  console.log(`  新增: ${chalk.green(added)}  |  删除: ${chalk.red(removed)}  |  修改: ${chalk.yellow(modified)}`);
  console.log('');

  return true;
}

module.exports = {
  fetchRemoteConfig,
  loadLocalConfig,
  saveConfig,
  mergeConfigs,
  syncRemoteConfig,
  diffConfig,
  deepDiff
};
