const templates = {
  'frontend-react': {
    name: 'Frontend React 项目模板',
    description: '适用于 React + TypeScript 前端项目的hook和流水线配置',
    config: {
      scopes: ['components', 'pages', 'hooks', 'utils', 'styles', 'api', 'assets'],
      branchPattern: '^(feature|fix|hotfix|release|develop|main|master)/.+$',
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
        name: 'Frontend CI Pipeline',
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
                command: 'npx prettier --check "src/**/*.{js,jsx,ts,tsx,css,md}"',
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
                dependencies: ['src', 'public'],
                cache: true
              }
            ]
          }
        ]
      }
    }
  },

  'backend-node': {
    name: 'Backend Node.js 项目模板',
    description: '适用于 Node.js 后端服务项目的hook和流水线配置',
    config: {
      scopes: ['api', 'services', 'models', 'controllers', 'middleware', 'utils', 'config', 'tests'],
      branchPattern: '^(feature|fix|hotfix|release|develop|main|master)/.+$',
      hooks: {
        'pre-commit': [
          { check: 'branch-name' },
          {
            check: 'no-console',
            when: {
              files: ['**/*.js', '**/*.ts']
            }
          },
          {
            check: 'no-debug',
            when: {
              files: ['**/*.js', '**/*.ts']
            }
          },
          { check: 'file-size' }
        ],
        'pre-push': [
          {
            script: 'npm test',
            when: {
              branch: ['main', 'master', 'develop']
            }
          }
        ],
        'commit-msg': [
          { check: 'commit-msg' }
        ]
      },
      pipeline: {
        name: 'Backend CI Pipeline',
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
                command: 'npx eslint . --ext .js,.ts',
                dependencies: ['src', 'lib'],
                cache: true
              }
            ]
          },
          {
            name: 'Test',
            steps: [
              {
                name: 'Unit Tests',
                command: 'npm test',
                dependencies: ['src', 'tests'],
                cache: false
              }
            ]
          }
        ]
      }
    }
  },

  'monorepo': {
    name: 'Monorepo 多包项目模板',
    description: '适用于 monorepo 多包项目的hook和流水线配置',
    config: {
      scopes: ['shared', 'apps', 'packages', 'tools'],
      branchPattern: '^(feature|fix|hotfix|release|develop|main|master)/.+$',
      workspaces: [
        { name: 'app-web', path: 'apps/web' },
        { name: 'app-mobile', path: 'apps/mobile' },
        { name: 'pkg-ui', path: 'packages/ui' },
        { name: 'pkg-utils', path: 'packages/utils' }
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
        name: 'Monorepo CI Pipeline',
        stages: [
          {
            name: 'Bootstrap',
            steps: [
              {
                name: 'Install and link',
                command: 'npm install',
                dependencies: ['package.json', 'package-lock.json', 'packages/*/package.json'],
                cache: true
              }
            ]
          },
          {
            name: 'Build All',
            parallel: true,
            steps: [
              {
                name: 'Build pkg-ui',
                command: 'cd packages/ui && npm run build',
                dependencies: ['packages/ui/src'],
                cache: true
              },
              {
                name: 'Build pkg-utils',
                command: 'cd packages/utils && npm run build',
                dependencies: ['packages/utils/src'],
                cache: true
              }
            ]
          },
          {
            name: 'Test',
            steps: [
              {
                name: 'Run all tests',
                command: 'npm test',
                dependencies: ['apps', 'packages'],
                cache: false
              }
            ]
          }
        ]
      }
    }
  }
};

function getTemplate(name) {
  return templates[name] || null;
}

function listTemplates() {
  return Object.entries(templates).map(([key, tpl]) => ({
    name: key,
    displayName: tpl.name,
    description: tpl.description
  }));
}

function applyTemplate(name) {
  const tpl = getTemplate(name);
  if (!tpl) {
    return null;
  }
  return tpl.config;
}

module.exports = {
  templates,
  getTemplate,
  listTemplates,
  applyTemplate
};
