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
const { runPipeline } = require('./lib/pipeline');
const { setup, showStats, initConfig } = require('./lib/configManager');
const { SUPPORTED_HOOKS, logError, logInfo } = require('./lib/utils');

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
      .action(async (options) => {
        await runPipeline(options.file);
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
  .command('stats')
  .description('显示本月hook拦截统计')
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
  console.log('  pipeline run             执行流水线');
  console.log('  setup                    根据配置文件安装hook');
  console.log('  init-config              创建示例配置文件');
  console.log('  stats                    显示拦截统计');
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
