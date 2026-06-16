const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const yaml = require('js-yaml');
const chalk = require('chalk');
const {
  getGitRoot,
  getCacheDir,
  ensureDir,
  formatTime,
  logSuccess,
  logError,
  logInfo,
  logWarn,
  execCommand
} = require('./utils');

function getPipelineFile() {
  const configPath = path.join(getGitRoot(), '.hookrc.yaml');
  if (fs.existsSync(configPath)) {
    return configPath;
  }
  const pipelinePath = path.join(getGitRoot(), 'pipeline.yaml');
  if (fs.existsSync(pipelinePath)) {
    return pipelinePath;
  }
  return null;
}

function loadPipelineConfig(customPath, workspace) {
  if (workspace) {
    const { getWorkspacePipeline } = require('./workspace');
    const pipeline = getWorkspacePipeline(workspace);
    if (pipeline) {
      return pipeline;
    }
    logWarn(`工作区 "${workspace}" 未找到独立配置，使用全局配置`);
  }

  const configFile = customPath || getPipelineFile();
  if (!configFile || !fs.existsSync(configFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configFile, 'utf8');
    const config = yaml.load(content) || {};
    return config.pipeline || null;
  } catch (e) {
    logError('解析pipeline配置失败: ' + e.message);
    return null;
  }
}

function getFileHash(filePath) {
  const fullPath = path.join(getGitRoot(), filePath);
  if (!fs.existsSync(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  return crypto.createHash('md5').update(fullPath + stat.mtimeMs + stat.size).digest('hex');
}

function getDependenciesHash(dependencies) {
  if (!dependencies || dependencies.length === 0) return null;
  
  const hashes = [];
  for (const dep of dependencies) {
    const fullPath = path.join(getGitRoot(), dep);
    if (fs.existsSync(fullPath)) {
      if (fs.statSync(fullPath).isDirectory()) {
        const files = getAllFilesInDir(fullPath);
        for (const f of files) {
          hashes.push(getFileHash(path.relative(getGitRoot(), f)));
        }
      } else {
        hashes.push(getFileHash(dep));
      }
    }
  }
  return hashes.filter(Boolean).join('|');
}

function getAllFilesInDir(dir) {
  const results = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...getAllFilesInDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function getStepCache(step) {
  const cacheDir = getCacheDir();
  ensureDir(cacheDir);
  const stepKey = crypto.createHash('md5').update(step.name + JSON.stringify(step)).digest('hex');
  return path.join(cacheDir, `pipeline_${stepKey}`);
}

function checkStepCache(step) {
  if (!step.cache) return false;
  
  const cacheFile = getStepCache(step);
  if (!fs.existsSync(cacheFile)) return false;

  try {
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const currentHash = getDependenciesHash(step.dependencies);
    
    if (currentHash && cacheData.dependenciesHash === currentHash) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function writeStepCache(step) {
  if (!step.cache) return;
  
  const cacheFile = getStepCache(step);
  const dependenciesHash = getDependenciesHash(step.dependencies);
  
  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: Date.now(),
    dependenciesHash
  }));
}

function getAllSteps(pipeline) {
  const steps = [];
  for (const stage of pipeline.stages || []) {
    if (stage.steps) {
      for (const step of stage.steps) {
        steps.push({
          ...step,
          stageName: stage.name,
          parallel: !!stage.parallel
        });
      }
    } else {
      steps.push({
        ...stage,
        stageName: stage.name,
        parallel: false
      });
    }
  }
  return steps;
}

function dryRunPipeline(customPath, options = {}) {
  const pipeline = loadPipelineConfig(customPath, options.workspace);
  if (!pipeline) {
    logError('未找到pipeline配置');
    process.exit(1);
  }

  const allSteps = getAllSteps(pipeline);

  console.log('');
  console.log(chalk.bold(`🔍 Pipeline Dry-Run: ${pipeline.name || '未命名'}`));
  console.log(chalk.gray('='.repeat(60)));
  console.log('');

  let stageIdx = 0;
  let totalSteps = 0;
  let cachedSteps = 0;

  for (const stage of (pipeline.stages || [])) {
    stageIdx++;
    const isParallel = stage.parallel;
    const steps = stage.steps || [stage];
    
    console.log(chalk.blue.bold(`  阶段 ${stageIdx}: ${stage.name || `Stage ${stageIdx}`}`) + 
      (isParallel ? chalk.gray(' [并行]') : ''));
    console.log(chalk.gray('  ' + '-'.repeat(56)));

    for (const step of steps) {
      totalSteps++;
      const willCache = checkStepCache(step);
      if (willCache) cachedSteps++;

      const status = willCache
        ? chalk.cyan('[CACHED]')
        : chalk.yellow('[WILL RUN]');

      console.log(`    ${status} ${step.name}`);
      console.log(`      ${chalk.gray('命令: ' + step.command)}`);
      
      if (step.dependencies && step.dependencies.length > 0) {
        console.log(`      ${chalk.gray('依赖: ' + step.dependencies.join(', '))}`);
      }
      if (step.cache) {
        console.log(`      ${chalk.gray('缓存: 启用')}`);
      }
    }
    console.log('');
  }

  console.log(chalk.gray('='.repeat(60)));
  console.log(`  总计: ${totalSteps} 个步骤, ${cachedSteps} 个预计缓存命中`);
  console.log('');
}

function graphPipeline(customPath, options = {}) {
  const pipeline = loadPipelineConfig(customPath, options.workspace);
  if (!pipeline) {
    logError('未找到pipeline配置');
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold(`📊 Pipeline DAG: ${pipeline.name || '未命名'}`));
  console.log(chalk.gray('='.repeat(60)));
  console.log('');

  const stages = pipeline.stages || [];

  if (stages.length === 0) {
    console.log(chalk.gray('  空流水线'));
    console.log('');
    return;
  }

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const steps = stage.steps || [stage];
    
    if (stage.parallel && steps.length > 1) {
      const maxNameLen = Math.max(...steps.map(s => s.name.length));
      
      console.log(`  ┌${'─'.repeat(maxNameLen + 4)}┐`);
      
      steps.forEach((step, idx) => {
        const name = step.name.padEnd(maxNameLen);
        const connector = idx === 0 ? '  │' : '  │';
        console.log(`${connector} ${chalk.cyan(name)} │`);
      });
      
      console.log(`  └${'─'.repeat(maxNameLen + 4)}┘`);
    } else {
      const step = steps[0];
      console.log(`  ▸ ${chalk.cyan(step.name)}`);
    }

    if (i < stages.length - 1) {
      console.log('  ↓');
    }
  }

  console.log('');
  console.log(chalk.gray('  图例: ▸ 串行步骤  │ 并行步骤  ↓ 依赖关系'));
  console.log('');
}

function validatePipeline(pipeline) {
  const errors = [];
  const warnings = [];

  if (!pipeline) {
    errors.push('未找到pipeline配置');
    return { valid: false, errors, warnings };
  }

  if (!pipeline.stages || pipeline.stages.length === 0) {
    warnings.push('pipeline中没有定义任何阶段');
  }

  const stepNames = new Set();
  const graph = {};

  for (let si = 0; si < (pipeline.stages || []).length; si++) {
    const stage = pipeline.stages[si];
    const steps = stage.steps || [stage];

    for (const step of steps) {
      if (!step.name) {
        errors.push(`阶段 ${si + 1} 中有步骤缺少name`);
        continue;
      }

      if (stepNames.has(step.name)) {
        errors.push(`步骤名重复: ${step.name}`);
      }
      stepNames.add(step.name);

      if (!step.command) {
        errors.push(`步骤 "${step.name}" 缺少command`);
      } else {
        const cmd = step.command.split(' ')[0];
        try {
          execSync(`which ${cmd} || command -v ${cmd}`, { stdio: 'ignore' });
        } catch {
          if (cmd !== 'echo' && !cmd.startsWith('npx') && !cmd.startsWith('npm') && !cmd.startsWith('node')) {
            warnings.push(`命令 "${cmd}" 可能不存在 (步骤: ${step.name})`);
          }
        }
      }

      if (step.dependencies) {
        const deps = Array.isArray(step.dependencies) ? step.dependencies : [step.dependencies];
        for (const dep of deps) {
          const fullPath = path.join(getGitRoot(), dep);
          if (!fs.existsSync(fullPath)) {
            warnings.push(`依赖文件/目录不存在: ${dep} (步骤: ${step.name})`);
          }
        }
      }

      graph[step.name] = step.depends_on || [];
    }
  }

  const visited = {};
  const recStack = {};

  function hasCycle(node) {
    if (recStack[node]) return true;
    if (visited[node]) return false;

    visited[node] = true;
    recStack[node] = true;

    for (const dep of graph[node] || []) {
      if (hasCycle(dep)) return true;
    }

    recStack[node] = false;
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (hasCycle(node)) {
      errors.push('检测到循环依赖');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function runValidation(customPath, options = {}) {
  const pipeline = loadPipelineConfig(customPath, options.workspace);
  const result = validatePipeline(pipeline);

  console.log('');
  console.log(chalk.bold('✅ Pipeline 配置验证'));
  console.log(chalk.gray('='.repeat(50)));
  console.log('');

  if (result.valid) {
    console.log(chalk.green('  配置验证通过 ✓'));
  } else {
    console.log(chalk.red('  配置验证失败 ✗'));
    console.log('');
    console.log(chalk.red('  错误:'));
    result.errors.forEach(err => {
      console.log(`    ✗ ${err}`);
    });
  }

  if (result.warnings.length > 0) {
    console.log('');
    console.log(chalk.yellow('  警告:'));
    result.warnings.forEach(warn => {
      console.log(`    ⚠ ${warn}`);
    });
  }

  console.log('');
  return result.valid;
}

function renderProgressBar(current, total, stageName, startTime) {
  const barWidth = 30;
  const progress = current / total;
  const filled = Math.round(barWidth * progress);
  const empty = barWidth - filled;

  const elapsed = Date.now() - startTime;
  const eta = current > 0 ? Math.round((elapsed / current) * (total - current)) : 0;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.round(progress * 100);

  let line = `  ${chalk.cyan(bar)} ${percent}% (${current}/${total})`;
  
  if (stageName) {
    line += ` ${chalk.gray('| 当前: ' + stageName)}`;
  }
  
  line += ` ${chalk.gray('| 预计剩余: ' + formatTime(eta))}`;

  return line;
}

function renderGanttChart(results, totalStartTime) {
  console.log('');
  console.log(chalk.bold('📈 执行时间线 (甘特图)'));
  console.log(chalk.gray('='.repeat(70)));
  console.log('');

  if (results.length === 0) return;

  const totalEnd = Math.max(...results.map(r => r.endTime));
  const totalDuration = totalEnd - totalStartTime;

  const chartWidth = 40;

  for (const result of results) {
    const startOffset = result.startTime - totalStartTime;
    const duration = result.endTime - result.startTime;
    
    const startPos = Math.round((startOffset / totalDuration) * chartWidth);
    const barLen = Math.max(1, Math.round((duration / totalDuration) * chartWidth));

    let bar = ' '.repeat(startPos) + chalk[result.success ? 'green' : 'red']('═'.repeat(barLen));
    
    const statusChar = result.success ? '✓' : '✗';
    const name = result.name.padEnd(20).substring(0, 20);
    
    console.log(`  ${statusChar} ${name} ${bar} ${formatTime(duration)}`);
  }

  console.log('');
  console.log(chalk.gray(`  总耗时: ${formatTime(totalDuration)}`));
  console.log('');
}

async function executeStep(step) {
  const startTime = Date.now();
  const isCached = checkStepCache(step);
  
  if (isCached) {
    const endTime = Date.now();
    return { 
      success: true, 
      cached: true, 
      duration: endTime - startTime,
      startTime,
      endTime,
      name: step.name
    };
  }
  
  try {
    const result = execCommand(step.command, { stdio: 'pipe' });
    
    if (!result.success) {
      const endTime = Date.now();
      return { 
        success: false, 
        cached: false, 
        duration: endTime - startTime, 
        error: result.error,
        startTime,
        endTime,
        name: step.name
      };
    }
    
    writeStepCache(step);
    const endTime = Date.now();
    return { 
      success: true, 
      cached: false, 
      duration: endTime - startTime,
      startTime,
      endTime,
      name: step.name
    };
  } catch (e) {
    const endTime = Date.now();
    return { 
      success: false, 
      cached: false, 
      duration: endTime - startTime, 
      error: e.message,
      startTime,
      endTime,
      name: step.name
    };
  }
}

async function executeParallel(steps) {
  const results = await Promise.all(steps.map(executeStep));
  
  const failed = results.find(r => !r.success);
  if (failed) {
    return { success: false, results };
  }
  
  return { success: true, results };
}

async function runPipeline(customPath, options = {}) {
  const pipeline = loadPipelineConfig(customPath, options.workspace);
  
  if (!pipeline) {
    logError('未找到pipeline配置，请创建 .hookrc.yaml 或 pipeline.yaml');
    process.exit(1);
  }

  if (!pipeline.stages || pipeline.stages.length === 0) {
    logWarn('pipeline中没有定义任何步骤');
    process.exit(0);
  }

  const allSteps = getAllSteps(pipeline);
  const totalSteps = allSteps.length;

  logInfo(`开始执行流水线: ${pipeline.name || '未命名'}`);
  console.log(chalk.gray('='.repeat(60)));

  const totalStartTime = Date.now();
  const allStepResults = [];
  let completedSteps = 0;

  for (let i = 0; i < pipeline.stages.length; i++) {
    const stage = pipeline.stages[i];
    const stageName = stage.name || `Stage ${i + 1}`;
    const steps = stage.steps || [stage];

    console.log(chalk.blue(`\n阶段 ${i + 1}: ${stageName}`));
    console.log(chalk.gray('-'.repeat(50)));

    let stageResult;

    if (stage.parallel && steps.length > 1) {
      stageResult = await executeParallel(steps);
      
      for (const r of stageResult.results) {
        allStepResults.push(r);
        completedSteps++;
        
        const status = r.cached 
          ? chalk.cyan('[CACHED]')
          : (r.success ? chalk.green('[OK]') : chalk.red('[FAIL]'));
        
        console.log(`  ${status} ${r.name} ${chalk.gray(formatTime(r.duration))}`);
      }
    } else {
      const stepResults = [];
      let stageSuccess = true;
      
      for (const step of steps) {
        console.log(`\n  步骤: ${step.name}`);
        const result = await executeStep(step);
        stepResults.push(result);
        allStepResults.push(result);
        completedSteps++;
        
        if (result.cached) {
          console.log(`    ${chalk.cyan('[CACHED]')} ${chalk.gray(formatTime(result.duration))}`);
        } else {
          console.log(`    ${chalk.yellow('[RUN]')} 命令: ${step.command}`);
          console.log(`    ${result.success ? chalk.green('成功') : chalk.red('失败')} ${chalk.gray(formatTime(result.duration))}`);
        }
        
        if (!result.success) {
          stageSuccess = false;
          break;
        }
      }
      stageResult = { success: stageSuccess, results: stepResults };
    }

    if (!stageResult.success) {
      console.log('');
      logError(`阶段 ${i + 1} 执行失败，流水线中止`);
      const totalDuration = Date.now() - totalStartTime;
      console.log(chalk.gray(`\n总耗时: ${formatTime(totalDuration)}`));
      
      renderGanttChart(allStepResults, totalStartTime);
      process.exit(1);
    }
  }

  const totalDuration = Date.now() - totalStartTime;
  console.log(chalk.gray('\n' + '='.repeat(60)));
  
  const totalStepsDone = allStepResults.length;
  const cachedSteps = allStepResults.filter(r => r.cached).length;
  
  logSuccess(`流水线执行完成 (${totalStepsDone} 步骤, ${cachedSteps} 缓存命中)`);
  console.log(chalk.green(`总耗时: ${formatTime(totalDuration)}`));

  renderGanttChart(allStepResults, totalStartTime);
}

module.exports = {
  runPipeline,
  loadPipelineConfig,
  dryRunPipeline,
  graphPipeline,
  validatePipeline,
  runValidation
};
