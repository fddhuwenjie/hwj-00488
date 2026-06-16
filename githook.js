#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const {
  init,
  add,
  list,
  remove,
  runStage
} = require('./lib/hookManager');
const { 
  runPipeline, 
  loadPipelineConfig,
  dryRunPipeline,
  graphPipeline,
  runValidation
} = require('./lib/pipeline');
const { setup, showStats, initConfig } = require('./lib/configManager');
const { SUPPORTED_HOOKS, logError, logInfo } = require('./lib/utils');
const {
  showHistory,
  exportHistory,
  clearHistory
} = require('./lib/history');
const {
  listTemplates,
  applyTemplate
} = require('./lib/templates');
const {
  syncRemoteConfig,
  diffConfig
} = require('./lib/sync');
const { saveConfig } = require('./lib/configManager');
const {
  listWorkspaces,
  addWorkspace,
  removeWorkspace
} = require('./lib/workspace');

const program = new Command();

program
  .name('githook')
  .description('Git Hook配置管理和本地CI流水线CLI工具')
  .version('1.0.0');

program
  .command('init')
  .description('在当前git仓库安装hook管理器(创建.githooks/目录)')
  .action(() => {
    init();
  });

program
  .command('add <hook-type> <script>')
  .description('添加hook脚本')
  .action((hookType, script) => {
    add(hookType, script);
  });

program
  .command('list')
  .alias('ls')
  .description('显示已配置的所有hook')
  .action(() => {
    list();
  });

program
  .command('remove <hook-type> [index]')
  .alias('rm')
  .description('删除指定hook')
  .action((hookType, index) => {
    remove(hookType, index);
  });

program
  .command('run')
  .description('运行指定阶段的hook检查')
  .option('--stage <stage>', '指定运行的hook阶段', 'pre-commit')
  .option('--hook-file <file>', 'hook文件路径(用于commit-msg)')
  .action(async (options) => {
    await runStage(options.stage, options.hookFile);
  });

program
  .command('pipeline')
  .description('本地流水线管理')
  .addCommand(
    new Command('run')
      .description('执行流水线')
      .option('-f, --file <path>', '指定pipeline配置文件路径')
      .option('--dry-run', '模拟执行，显示步骤和预计缓存命中情况')
      .option('-w, --workspace <name>', '指定子项目工作区')
      .action(async (options) => {
        if (options.dryRun) {
          dryRunPipeline(options.file, { workspace: options.workspace });
        } else {
          await runPipeline(options.file, { workspace: options.workspace });
        }
      })
  )
  .addCommand(
    new Command('graph')
      .description('以ASCII图形展示流水线DAG结构')
      .option('-f, --file <path>', '指定pipeline配置文件路径')
      .option('-w, --workspace <name>', '指定子项目工作区')
      .action((options) => {
        graphPipeline(options.file, { workspace: options.workspace });
      })
  )
  .addCommand(
    new Command('validate')
      .description('验证pipeline配置的合法性')
      .option('-f, --file <path>', '指定pipeline配置文件路径')
      .option('-w, --workspace <name>', '指定子项目工作区')
      .action((options) => {
        const valid = runValidation(options.file, { workspace: options.workspace });
        process.exit(valid ? 0 : 1);
      })
  );

program
  .command('setup')
  .description('根据.hookrc.yaml配置文件一键安装所有hook')
  .action(async () => {
    await setup();
  });

program
  .command('init-config')
  .description('创建示例.hookrc.yaml配置文件')
  .action(() => {
    initConfig();
  });

program
  .command('sync <url>')
  .description('从远程URL同步hook配置')
  .option('--merge', '合并远程配置到本地而非覆盖')
  .action(async (url, options) => {
    const success = await syncRemoteConfig(url, { merge: options.merge });
    process.exit(success ? 0 : 1);
  });

program
  .command('template')
  .description('配置模板管理')
  .addCommand(
    new Command('list')
      .description('列出可用的配置模板')
      .action(() => {
        const templates = listTemplates();
        console.log('');
        console.log(chalk.bold('📦 可用的配置模板'));
        console.log(chalk.gray('='.repeat(50)));
        templates.forEach(tpl => {
          console.log(`  ${chalk.cyan(tpl.name)}`);
          console.log(`    ${tpl.displayName}`);
          console.log(`    ${chalk.gray(tpl.description)}`);
          console.log('');
        });
      })
  )
  .addCommand(
    new Command('apply <name>')
      .description('应用指定模板')
      .action((name) => {
        const config = applyTemplate(name);
        if (!config) {
          logError(`未找到模板: ${name}`);
          console.log('使用 template list 查看可用模板');
          process.exit(1);
        }
        saveConfig(config);
        logSuccess(`已应用模板: ${name}`);
      })
  );

program
  .command('diff <source>')
  .description('对比当前配置与指定URL或模板的差异')
  .action(async (source) => {
    await diffConfig(source);
  });

program
  .command('workspace')
  .description('多项目工作区管理')
  .addCommand(
    new Command('list')
      .description('列出所有工作区')
      .action(() => {
        listWorkspaces();
      })
  )
  .addCommand(
    new Command('add <path> <name>')
      .description('注册子项目工作区')
      .action((workspacePath, name) => {
        const success = addWorkspace(workspacePath, name);
        process.exit(success ? 0 : 1);
      })
  )
  .addCommand(
    new Command('remove <name>')
      .alias('rm')
      .description('移除工作区')
      .action((name) => {
        const success = removeWorkspace(name);
        process.exit(success ? 0 : 1);
      })
  );

program
  .command('history')
  .description('显示hook执行历史记录')
  .option('--filter <type>', '过滤记录类型: pass/fail')
  .option('--since <time>', '显示指定时间范围内的记录，如 7d, 24h, 30m')
  .option('--hook <type>', '按hook类型过滤')
  .option('-n, --limit <number>', '显示最近N条记录', '50')
  .action((options) => {
    showHistory({
      filter: options.filter,
      since: options.since,
      hookType: options.hook,
      limit: parseInt(options.limit, 10)
    });
  })
  .addCommand(
    new Command('export')
      .description('导出历史记录')
      .option('--format <type>', '导出格式: csv/json', 'csv')
      .option('-o, --output <path>', '输出文件路径')
      .action((options) => {
        exportHistory(options.format, options.output);
      })
  )
  .addCommand(
    new Command('clear')
      .description('清空历史记录')
      .action(() => {
        clearHistory();
      })
  );

program
  .command('stats')
  .description('显示本月hook执行统计')
  .action(() => {
    showStats();
  });

program.on('command:*', (operands) => {
  logError(`未知命令: ${operands[0]}`);
  console.log('');
  logInfo('支持的命令:');
  console.log('  init                     初始化hook管理器');
  console.log('  add <type> <script>      添加hook脚本');
  console.log('  list                     列出所有hook');
  console.log('  remove <type> [index]    删除hook');
  console.log('  run [--stage]            运行hook检查');
  console.log('  pipeline                 流水线管理(run/graph/validate)');
  console.log('  setup                    根据配置文件安装hook');
  console.log('  init-config              创建示例配置文件');
  console.log('  sync <url>               从远程同步配置');
  console.log('  template                 模板管理(list/apply)');
  console.log('  diff <source>            对比配置差异');
  console.log('  workspace                工作区管理(list/add/remove)');
  console.log('  history                  执行历史(export/clear)');
  console.log('  stats                    显示执行统计');
  console.log('');
  logInfo('支持的hook类型: ' + SUPPORTED_HOOKS.join(', '));
  process.exit(1);
});

if (process.argv.length === 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((e) => {
  console.error(chalk.red('执行出错:'), e.message);
  process.exit(1);
});
