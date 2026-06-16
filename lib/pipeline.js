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

function loadPipelineConfig(customPath) {
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

async function executeStep(step) {
  const startTime = Date.now();
  const isCached = checkStepCache(step);
  
  console.log(chalk.bold(`\n  步骤: ${step.name}`));
  
  if (isCached) {
    const duration = Date.now() - startTime;
    console.log(`    ${chalk.cyan('[CACHED]')} ${chalk.gray(formatTime(duration))}`);
    return { success: true, cached: true, duration };
  }

  console.log(`    ${chalk.yellow('[RUN]')} 命令: ${step.command}`);
  
  try {
    const result = execCommand(step.command, { stdio: 'inherit' });
    
    if (!result.success) {
      const duration = Date.now() - startTime;
      console.log(`    ${chalk.red('失败')} ${chalk.gray(formatTime(duration))}`);
      return { success: false, cached: false, duration, error: result.error };
    }
    
    writeStepCache(step);
    const duration = Date.now() - startTime;
    console.log(`    ${chalk.green('成功')} ${chalk.gray(formatTime(duration))}`);
    return { success: true, cached: false, duration };
  } catch (e) {
    const duration = Date.now() - startTime;
    console.log(`    ${chalk.red('失败')} ${chalk.gray(formatTime(duration))}`);
    return { success: false, cached: false, duration, error: e.message };
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

async function runPipeline(customPath) {
  const pipeline = loadPipelineConfig(customPath);
  
  if (!pipeline) {
    logError('未找到pipeline配置，请创建 .hookrc.yaml 或 pipeline.yaml');
    process.exit(1);
  }

  if (!pipeline.stages || pipeline.stages.length === 0) {
    logWarn('pipeline中没有定义任何步骤');
    process.exit(0);
  }

  logInfo(`开始执行流水线: ${pipeline.name || '未命名'}`);
  console.log(chalk.gray('='.repeat(50)));

  const totalStartTime = Date.now();
  const allResults = [];

  for (let i = 0; i < pipeline.stages.length; i++) {
    const stage = pipeline.stages[i];
    console.log(chalk.blue(`\n阶段 ${i + 1}: ${stage.name || `Stage ${i + 1}`}`));
    console.log(chalk.gray('-'.repeat(40)));

    let stageResult;
    if (stage.parallel && stage.steps) {
      stageResult = await executeParallel(stage.steps);
    } else if (stage.steps) {
      const stepResults = [];
      let stageSuccess = true;
      
      for (const step of stage.steps) {
        const result = await executeStep(step);
        stepResults.push(result);
        if (!result.success) {
          stageSuccess = false;
          break;
        }
      }
      stageResult = { success: stageSuccess, results: stepResults };
    } else {
      const result = await executeStep(stage);
      stageResult = { success: result.success, results: [result] };
    }

    allResults.push(stageResult);

    if (!stageResult.success) {
      console.log('');
      logError(`阶段 ${i + 1} 执行失败，流水线中止`);
      const totalDuration = Date.now() - totalStartTime;
      console.log(chalk.gray(`\n总耗时: ${formatTime(totalDuration)}`));
      process.exit(1);
    }
  }

  const totalDuration = Date.now() - totalStartTime;
  console.log(chalk.gray('\n' + '='.repeat(50)));
  
  const totalSteps = allResults.reduce((sum, sr) => sum + (sr.results ? sr.results.length : 1), 0);
  const cachedSteps = allResults.reduce((sum, sr) => sum + (sr.results || []).filter(r => r.cached).length, 0);
  
  logSuccess(`流水线执行完成 (${totalSteps} 步骤, ${cachedSteps} 缓存命中)`);
  console.log(chalk.green(`总耗时: ${formatTime(totalDuration)}`));
}

module.exports = {
  runPipeline,
  loadPipelineConfig
};
