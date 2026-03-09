import chalk from 'chalk';

const toolColors: Record<string, (s: string) => string> = {
  'Claude Code': chalk.bold.hex('#D97757'),
  'Cursor': chalk.bold.hex('#00B4D8'),
  'Codex': chalk.bold.hex('#10A37F'),
  'Copilot': chalk.bold.hex('#2EA6FF'),
  'Canonical': chalk.bold.white,
  'Multi-agent': chalk.bold.blue,
};

export function toolColor(toolName: string): (s: string) => string {
  if (toolColors[toolName]) return toolColors[toolName];
  for (const [key, color] of Object.entries(toolColors)) {
    if (toolName.startsWith(key + ' ')) return color;
  }
  return chalk.bold.white;
}

export const theme = {
  title: chalk.bold,
  scopeHeader: chalk.bold.white,
  scopeGlobal: chalk.bold.blue,
  scopeCurrent: chalk.bold.green,
  scopeProject: chalk.bold.white,
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
  dim: chalk.dim,
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
