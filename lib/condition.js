const fs = require('fs');
const path = require('path');
const {
  getStagedFiles,
  getCurrentBranch,
  getGitRoot
} = require('./utils');

function minimatch(filePath, pattern) {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp('^' + regexStr + '$');
  return regex.test(filePath);
}

function matchesAnyPattern(filePath, patterns) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  return patternList.some(pattern => minimatch(filePath, pattern));
}

function checkFilesCondition(filesPattern) {
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) return false;

  const matched = stagedFiles.some(file => matchesAnyPattern(file, filesPattern));
  return matched;
}

function checkBranchCondition(branchPattern) {
  const currentBranch = getCurrentBranch();
  if (!currentBranch) return false;

  if (Array.isArray(branchPattern)) {
    return branchPattern.some(b => {
      if (b.includes('*') || b.includes('?')) {
        return minimatch(currentBranch, b);
      }
      return currentBranch === b;
    });
  }

  if (typeof branchPattern === 'string') {
    if (branchPattern.includes('*') || branchPattern.includes('?')) {
      return minimatch(currentBranch, branchPattern);
    }
    return currentBranch === branchPattern;
  }

  return false;
}

function checkEnvCondition(envConfig) {
  if (typeof envConfig === 'string') {
    return !!process.env[envConfig];
  }

  if (Array.isArray(envConfig)) {
    return envConfig.every(envVar => !!process.env[envVar]);
  }

  if (typeof envConfig === 'object') {
    for (const [key, value] of Object.entries(envConfig)) {
      const envValue = process.env[key];
      if (value === true) {
        if (!envValue) return false;
      } else if (value === false) {
        if (envValue) return false;
      } else {
        if (envValue !== String(value)) return false;
      }
    }
    return true;
  }

  return false;
}

function checkTimeCondition(timeConfig) {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour * 60 + minute;

  if (timeConfig.weekdays !== undefined) {
    const weekdays = Array.isArray(timeConfig.weekdays) ? timeConfig.weekdays : [timeConfig.weekdays];
    const isWeekday = weekdays.some(d => {
      if (typeof d === 'number') return day === d;
      const dayMap = {
        'sun': 0, 'sunday': 0,
        'mon': 1, 'monday': 1,
        'tue': 2, 'tuesday': 2,
        'wed': 3, 'wednesday': 3,
        'thu': 4, 'thursday': 4,
        'fri': 5, 'friday': 5,
        'sat': 6, 'saturday': 6
      };
      return dayMap[d.toLowerCase()] === day;
    });
    if (!isWeekday) return false;
  }

  if (timeConfig.workhours !== undefined) {
    const wh = timeConfig.workhours;
    const [startStr, endStr] = wh.split('-');
    const startMin = parseTimeStr(startStr.trim());
    const endMin = parseTimeStr(endStr.trim());
    if (currentTime < startMin || currentTime > endMin) return false;
  }

  return true;
}

function parseTimeStr(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function evaluateCondition(when) {
  if (!when) return { passed: true, reason: '' };

  const conditions = [];

  if (when.files !== undefined) {
    const passed = checkFilesCondition(when.files);
    conditions.push({ type: 'files', passed });
  }

  if (when.branch !== undefined) {
    const passed = checkBranchCondition(when.branch);
    conditions.push({ type: 'branch', passed });
  }

  if (when.env !== undefined) {
    const passed = checkEnvCondition(when.env);
    conditions.push({ type: 'env', passed });
  }

  if (when.time !== undefined) {
    const passed = checkTimeCondition(when.time);
    conditions.push({ type: 'time', passed });
  }

  const allPassed = conditions.every(c => c.passed);
  const failedConditions = conditions.filter(c => !c.passed).map(c => c.type);

  return {
    passed: allPassed,
    reason: failedConditions.length > 0 ? failedConditions.join(', ') : ''
  };
}

module.exports = {
  evaluateCondition,
  checkFilesCondition,
  checkBranchCondition,
  checkEnvCondition,
  checkTimeCondition,
  minimatch
};
