const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const {
  getGitRoot,
  getHookDir,
  ensureDir,
  formatTime,
  logSuccess,
  logInfo,
  logWarn
} = require('./utils');

const HISTORY_FILE = 'history.jsonl';

function getHistoryFile() {
  return path.join(getHookDir(), HISTORY_FILE);
}

function ensureHistoryFile() {
  const historyFile = getHistoryFile();
  ensureDir(path.dirname(historyFile));
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, '');
  }
  return historyFile;
}

function recordExecution(record) {
  const historyFile = ensureHistoryFile();
  const entry = {
    timestamp: new Date().toISOString(),
    hookType: record.hookType || '',
    branch: record.branch || '',
    checkName: record.checkName || '',
    passed: record.passed,
    reason: record.reason || '',
    durationMs: record.durationMs || 0
  };
  fs.appendFileSync(historyFile, JSON.stringify(entry) + '\n');
}

function readAllHistory() {
  const historyFile = getHistoryFile();
  if (!fs.existsSync(historyFile)) {
    return [];
  }
  const content = fs.readFileSync(historyFile, 'utf8');
  const lines = content.trim().split('\n').filter(line => line);
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function filterHistory(records, options = {}) {
  let filtered = [...records];

  if (options.filter === 'fail') {
    filtered = filtered.filter(r => !r.passed);
  } else if (options.filter === 'pass') {
    filtered = filtered.filter(r => r.passed);
  }

  if (options.since) {
    const sinceDate = parseSince(options.since);
    if (sinceDate) {
      filtered = filtered.filter(r => new Date(r.timestamp) >= sinceDate);
    }
  }

  if (options.hookType) {
    filtered = filtered.filter(r => r.hookType === options.hookType);
  }

  return filtered;
}

function parseSince(sinceStr) {
  const match = sinceStr.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'm':
      return new Date(now.getTime() - value * 60 * 1000);
    default:
      return null;
  }
}

function formatHistoryTable(records, limit = 50) {
  const displayRecords = records.slice(-limit).reverse();

  if (displayRecords.length === 0) {
    logWarn('暂无执行记录');
    return;
  }

  const headers = ['#', '时间', 'Hook类型', '分支', '检查项', '状态', '耗时', '原因'];
  const colWidths = [4, 20, 14, 16, 18, 8, 10, 30];

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  console.log(chalk.bold(headerLine));
  console.log(chalk.gray('-'.repeat(headerLine.length)));

  displayRecords.forEach((record, index) => {
    const time = new Date(record.timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const status = record.passed
      ? chalk.green('PASS'.padEnd(8))
      : chalk.red('FAIL'.padEnd(8));

    const duration = formatTime(record.durationMs || 0);
    const reason = (record.reason || '').substring(0, 28);

    const row = [
      String(index + 1).padEnd(4),
      time.padEnd(20),
      (record.hookType || '').padEnd(14),
      (record.branch || '').padEnd(16),
      (record.checkName || '').padEnd(18),
      status,
      duration.padEnd(10),
      reason
    ].join('  ');

    console.log(row);
  });

  console.log('');
  logInfo(`共 ${displayRecords.length} 条记录 (显示最近 ${limit} 条)`);
}

function showHistory(options = {}) {
  const allRecords = readAllHistory();
  const filtered = filterHistory(allRecords, options);
  formatHistoryTable(filtered, options.limit || 50);
}

function exportHistory(format = 'csv', outputPath) {
  const allRecords = readAllHistory();

  if (allRecords.length === 0) {
    logWarn('暂无历史记录可导出');
    return;
  }

  let content = '';
  let filename = outputPath;

  if (format === 'csv') {
    const headers = ['timestamp', 'hookType', 'branch', 'checkName', 'passed', 'reason', 'durationMs'];
    content = headers.join(',') + '\n';
    for (const record of allRecords) {
      const row = [
        record.timestamp,
        record.hookType,
        record.branch,
        record.checkName,
        record.passed ? 'true' : 'false',
        `"${(record.reason || '').replace(/"/g, '""')}"`,
        record.durationMs
      ].join(',');
      content += row + '\n';
    }
    if (!filename) filename = path.join(getGitRoot(), 'githook_history.csv');
  } else if (format === 'json') {
    content = JSON.stringify(allRecords, null, 2);
    if (!filename) filename = path.join(getGitRoot(), 'githook_history.json');
  } else {
    throw new Error(`不支持的导出格式: ${format}`);
  }

  fs.writeFileSync(filename, content, 'utf8');
  logSuccess(`已导出 ${allRecords.length} 条记录到 ${filename}`);
}

function clearHistory() {
  const historyFile = getHistoryFile();
  if (fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, '');
    logSuccess('历史记录已清空');
  } else {
    logWarn('历史记录文件不存在');
  }
}

function getStatsFromHistory() {
  const allRecords = readAllHistory();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const monthRecords = allRecords.filter(r => {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return key === monthKey;
  });

  const failedRecords = monthRecords.filter(r => !r.passed);
  const passedRecords = monthRecords.filter(r => r.passed);

  const byHookType = {};
  for (const record of monthRecords) {
    if (!byHookType[record.hookType]) {
      byHookType[record.hookType] = { pass: 0, fail: 0, total: 0 };
    }
    byHookType[record.hookType].total++;
    if (record.passed) {
      byHookType[record.hookType].pass++;
    } else {
      byHookType[record.hookType].fail++;
    }
  }

  return {
    total: monthRecords.length,
    passed: passedRecords.length,
    failed: failedRecords.length,
    byHookType,
    recentFailures: failedRecords.slice(-5).reverse()
  };
}

module.exports = {
  recordExecution,
  readAllHistory,
  filterHistory,
  showHistory,
  exportHistory,
  clearHistory,
  getStatsFromHistory
};
