import chalk from 'chalk';

export const theme = {
  title: chalk.bold,
  scopeHeader: chalk.bold.white,
  toolName: chalk.bold.white,
  category: chalk.yellow,
  categoryExtra: chalk.dim.yellow,
  path: chalk.dim,
  symlinkArrow: chalk.cyan('-->'),
  symlinkTarget: chalk.cyan,
  description: chalk.gray,
  notFound: chalk.dim.italic,
  treeLine: chalk.dim,
  selected: chalk.inverse,
  searchHighlight: chalk.bold.underline,
  error: chalk.red.bold,
  warn: chalk.yellow.bold,
  info: chalk.blue.bold,
} as const;

export const tree = {
  branch: '├── ',
  last: '└── ',
  pipe: '│   ',
  space: '    ',
  arrow: ' --> ',
} as const;
