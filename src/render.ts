import chalk from 'chalk';
import path from 'node:path';
import os from 'node:os';
import type { ScanResult, ToolConfig, ConfigEntry, Diagnostic, CostReport } from './types.js';
import type { WhereInstallation } from './scan.js';
import { matchesDisabledCategory } from './config.js';
import { toolColor } from './ui/theme.js';

function tildify(p: string): string {
  const home = os.homedir();
  if (p === home || p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function truncateDesc(s: string, max = 50): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function groupByTool(configs: ToolConfig[]): Map<string, ToolConfig[]> {
  const map = new Map<string, ToolConfig[]>();
  for (const tc of configs) {
    const list = map.get(tc.tool) ?? [];
    list.push(tc);
    map.set(tc.tool, list);
  }
  return map;
}

function renderToolBlock(configs: ToolConfig[], tildifyPath: (p: string) => string): string {
  const lines: string[] = [];
  const dim = chalk.dim;
  const branch = dim('├── ');
  const last = dim('└── ');
  const pipe = dim('│');

  if (configs.length === 1 && configs[0].tool === 'Canonical' && configs[0].category === 'Skills') {
    const tc = configs[0];
    const label = toolColor('Canonical')('Canonical Store');
    const basePath = dim('  ' + tildifyPath(tc.basePath) + path.sep);
    lines.push(`  ${label}${basePath}`);
    if (tc.entries.length === 0 && !tc.exists) {
      lines.push(`  ${branch}${chalk.dim.italic('(not found)')}`);
    } else if (tc.entries.length === 0) {
      lines.push(`  ${branch}${chalk.dim.italic('(empty)')}`);
    } else {
      tc.entries.forEach((e, i) => {
        const isLast = i === tc.entries.length - 1;
        const prefix = isLast ? last : branch;
        const name = chalk.bold.white(e.name + '/SKILL.md');
        const desc = e.description ? chalk.gray(' "' + truncateDesc(e.description) + '"') : '';
        const symPart = e.symlink
          ? chalk.cyan(' --> ') + chalk.cyan(e.symlink.raw)
          : '';
        lines.push(`  ${prefix}${name}${symPart}${desc}`);
      });
    }
    return lines.join('\n');
  }

  const toolName = toolColor(configs[0].tool)(configs[0].tool);
  lines.push(`  ${toolName}`);
  configs.forEach((tc, cfgIdx) => {
    const isLastCfg = cfgIdx === configs.length - 1;
    const catPrefix = isLastCfg ? last : branch;
    const catLabel = chalk.yellow(tc.category);
    const labelExtra = tc.label ? chalk.yellow.dim(' ' + tc.label) : '';
    const basePath = dim('  ' + tildifyPath(tc.basePath) + (tc.category === 'Context' ? '' : path.sep));
    lines.push(`  ${catPrefix}${catLabel}${labelExtra}${basePath}`);
    const pipePrefix = isLastCfg ? '      ' : `  ${pipe}   `;
    if (tc.entries.length === 0 && !tc.exists) {
      lines.push(`${pipePrefix}${last}${chalk.dim.italic('(not found)')}`);
    } else if (tc.entries.length === 0) {
      lines.push(`${pipePrefix}${last}${chalk.dim.italic('(empty)')}`);
    } else {
      tc.entries.forEach((e, i) => {
        const isLast = i === tc.entries.length - 1;
        const prefix = isLast ? last : branch;
        const displayName = tc.category === 'MCP Servers' || tc.category === 'Hooks'
          ? e.name
          : e.path.endsWith('SKILL.md') ? e.name + '/SKILL.md' : path.basename(e.path);
        const name = chalk.bold.white(displayName);
        const desc = e.description
          ? tc.category === 'MCP Servers' || tc.category === 'Hooks'
            ? ' ' + chalk.gray(e.description)
            : chalk.gray(' "' + truncateDesc(e.description) + '"')
          : '';
        const symPart = e.symlink
          ? chalk.cyan(' --> ') + chalk.cyan(e.symlink.raw)
          : '';
        lines.push(`${pipePrefix}${prefix}${name}${symPart}${desc}`);
      });
    }
  });
  return lines.join('\n');
}

function groupByCategory(configs: ToolConfig[]): Map<string, ToolConfig[]> {
  const map = new Map<string, ToolConfig[]>();
  for (const tc of configs) {
    const list = map.get(tc.category) ?? [];
    list.push(tc);
    map.set(tc.category, list);
  }
  return map;
}

function renderCurrentBlock(configs: ToolConfig[]): string {
  const lines: string[] = [];
  const dim = chalk.dim;
  const branch = dim('├── ');
  const last = dim('└── ');

  const byCategory = groupByCategory(configs);
  const categories = [...byCategory.entries()];
  categories.forEach(([category, tcs], catIdx) => {
    const isLastCat = catIdx === categories.length - 1;
    const catPrefix = isLastCat ? last : branch;
    lines.push(`  ${catPrefix}${chalk.yellow(category)}`);
    const catPipe = isLastCat ? '      ' : `  ${dim('│')}   `;
    const byTool = groupByTool(tcs);
    const tools = [...byTool.entries()];
    tools.forEach(([, toolConfigs], toolIdx) => {
      const isLastTool = toolIdx === tools.length - 1;
      const toolPrefix = isLastTool ? last : branch;
      for (let ti = 0; ti < toolConfigs.length; ti++) {
        const tc = toolConfigs[ti];
        const isActuallyLast = isLastTool && ti === toolConfigs.length - 1;
        const prefix = isActuallyLast ? last : branch;
        const labelExtra = tc.label ? chalk.dim(' ' + tc.label) : '';
        const toolLabel = toolColor(tc.tool)(tc.tool) + labelExtra;
        const basePath = dim('  ' + tildify(tc.basePath) + (tc.category === 'Context' ? '' : path.sep));
        lines.push(`${catPipe}${prefix}${toolLabel}${basePath}`);
        const toolPipe = isActuallyLast ? catPipe + '    ' : catPipe + `${dim('│')}   `;
        tc.entries.forEach((e, i) => {
          const isLast = i === tc.entries.length - 1;
          const ePrefix = isLast ? last : branch;
          const displayName = tc.category === 'MCP Servers' || tc.category === 'Hooks'
            ? e.name
            : e.path.endsWith('SKILL.md') ? e.name + '/SKILL.md' : path.basename(e.path);
          const name = chalk.bold.white(displayName);
          const desc = e.description
            ? tc.category === 'MCP Servers' || tc.category === 'Hooks'
              ? ' ' + chalk.gray(e.description)
              : chalk.gray(' "' + truncateDesc(e.description) + '"')
            : '';
          const symPart = e.symlink
            ? chalk.cyan(' --> ') + chalk.cyan(e.symlink.raw)
            : '';
          lines.push(`${toolPipe}${ePrefix}${name}${symPart}${desc}`);
        });
      }
    });
  });
  return lines.join('\n');
}

export function renderStatic(result: ScanResult, disabledTools?: string[], disabledCategories?: string[]): string {
  const disabledT = new Set(disabledTools ?? []);
  const disabledC = new Set(disabledCategories ?? []);
  const filterTc = (configs: ToolConfig[]) =>
    configs.filter((tc) => !disabledT.has(tc.tool) && !matchesDisabledCategory(tc.label, disabledC));

  const globalConfigs = filterTc(result.global);
  const projectConfigs = filterTc(result.project);

  const lines: string[] = [];
  lines.push(chalk.bold('AGENTLENS -- Agent Configuration Map'));
  lines.push('=====================================');
  lines.push('');

  const currentConfigs = [...globalConfigs, ...projectConfigs].filter(
    (tc) => tc.entries.length > 0
  );
  if (currentConfigs.length > 0) {
    lines.push(chalk.bold.green('CURRENT') + chalk.dim('  ' + tildify(result.projectPath)));
    lines.push('');
    lines.push(renderCurrentBlock(currentConfigs));
    lines.push('');
  }

  lines.push(chalk.bold.blue('GLOBAL'));
  lines.push('');
  const globalByTool = groupByTool(globalConfigs);
  for (const [, configs] of globalByTool) {
    lines.push(renderToolBlock(configs, tildify));
  }
  lines.push('');

  lines.push(chalk.bold.white('PROJECT') + chalk.dim('  ' + tildify(result.projectPath)));

  lines.push('');
  if (projectConfigs.length === 0) {
    lines.push('  ' + chalk.dim.italic('(no project-level agent config found)'));
  } else {
    const projectByTool = groupByTool(projectConfigs);
    for (const [, configs] of projectByTool) {
      lines.push(renderToolBlock(configs, tildify));
    }
  }

  if (result.projects && result.projects.length > 0) {
    lines.push('');
    lines.push(chalk.bold.white('OTHER PROJECTS') + chalk.dim(`  (${result.projects.length} discovered)`));
    for (const proj of result.projects) {
      lines.push('');
      lines.push(chalk.bold.white('  ' + tildify(proj.path)));
      const filteredProjConfigs = filterTc(proj.configs);
      if (filteredProjConfigs.length === 0) {
        lines.push('    ' + chalk.dim.italic('(no agent config)'));
      } else {
        const projByTool = groupByTool(filteredProjConfigs);
        for (const [, configs] of projByTool) {
          lines.push(renderToolBlock(configs, tildify));
        }
      }
    }
  }

  return lines.join('\n');
}

export function renderDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return '';
  const lines: string[] = [];
  lines.push('ISSUES FOUND');
  lines.push('');
  for (const d of diagnostics) {
    const tag =
      d.severity === 'error'
        ? chalk.red.bold('[ERR] ')
        : d.severity === 'warn'
          ? chalk.yellow.bold('[WARN] ')
          : chalk.blue.bold('[INFO] ');
    lines.push(`  ${tag}  ${d.message}`);
    if (d.path) lines.push(`         ${d.path}`);
    if (d.details) lines.push(`         ${d.details}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderWhereResult(canonicalSkills: ConfigEntry[], installations: WhereInstallation[]): string {
  const lines: string[] = [];
  const dim = chalk.dim;
  const branch = dim('├── ');
  const last = dim('└── ');
  const installBySkill = new Map<string, typeof installations>();
  for (const inst of installations) {
    const list = installBySkill.get(inst.skillName) ?? [];
    list.push(inst);
    installBySkill.set(inst.skillName, list);
  }
  for (const skill of canonicalSkills) {
    const name = chalk.bold.white(skill.name);
    lines.push(`${name}`);
    const insts = installBySkill.get(skill.name) ?? [];
    insts.forEach((inst, i) => {
      const prefix = i === insts.length - 1 ? last : branch;
      const loc = chalk.dim(inst.location);
      const toolScope = chalk.yellow(`[${inst.tool} ${inst.scope}]`);
      lines.push(`  ${prefix}${loc}  ${toolScope}`);
    });
    if (insts.length === 0) {
      lines.push(`  ${last}${chalk.dim.italic('(no installations)')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function renderCostStatic(report: CostReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`AGENTLENS -- Cost Report: ${report.month}`));
  lines.push('='.repeat(45));
  lines.push('');

  let grandTotal = 0;

  for (const tool of report.tools) {
    const hasCost = tool.totalCostUsd > 0 || tool.models.some(m => m.costUsd > 0);
    const hasRequests = tool.totalRequests != null && tool.totalRequests > 0;
    const hasLimit = tool.maxRequests != null && tool.maxRequests > 0;

    let summaryStr: string;
    if (tool.error) {
      summaryStr = chalk.red('--');
    } else if (hasCost) {
      summaryStr = chalk.green('$' + tool.totalCostUsd.toFixed(2));
    } else if (hasRequests && hasLimit) {
      summaryStr = chalk.cyan(`${tool.totalRequests} / ${tool.maxRequests} reqs`);
    } else if (hasRequests) {
      summaryStr = chalk.cyan(`${tool.totalRequests} reqs`);
    } else {
      summaryStr = chalk.dim('--');
    }

    const planLabel = tool.planType ? chalk.dim(` (${tool.planType})`) : '';
    lines.push(`${toolColor(tool.tool)(tool.tool)}${planLabel}${' '.repeat(Math.max(1, 40 - tool.tool.length - (tool.planType ? tool.planType.length + 3 : 0)))}${summaryStr}`);

    if (tool.error) {
      lines.push(`  ${chalk.red('Error: ' + tool.error)}`);
      lines.push('');
      continue;
    }

    lines.push(chalk.dim(`  Period: ${tool.period}`));

    if (hasRequests && hasLimit) {
      const pct = ((tool.totalRequests! / tool.maxRequests!) * 100).toFixed(1);
      const barWidth = 20;
      const filled = Math.round((tool.totalRequests! / tool.maxRequests!) * barWidth);
      const bar = chalk.cyan('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(barWidth - filled));
      lines.push(`  ${bar} ${tool.totalRequests} / ${tool.maxRequests} premium requests (${pct}%)`);
    }

    if (tool.onDemand?.enabled) {
      const used = (tool.onDemand.usedCents / 100).toFixed(2);
      const limit = (tool.onDemand.limitCents / 100).toFixed(2);
      const onDemandStr = `  On-Demand: ${chalk.green('$' + used)} / ${chalk.green('$' + limit)}`;
      lines.push(onDemandStr);
    }

    if (tool.claudeAi) {
      const ca = tool.claudeAi;
      if (ca.orgName) lines.push(chalk.dim(`  Org: ${ca.orgName}`));
      const limitLabel = ca.limitCents == null ? 'Unlimited' : `$${(ca.limitCents / 100).toFixed(2)}`;
      lines.push(`  Spend limit: ${chalk.cyan(limitLabel)}`);
      if (ca.limitCents != null && ca.limitCents > 0) {
        const ratio = ca.spentCents / ca.limitCents;
        const barWidth = 20;
        const filled = Math.round(ratio * barWidth);
        const bar = chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(barWidth - filled));
        const pctStr = (ratio * 100).toFixed(1);
        lines.push(`  ${bar} $${(ca.spentCents / 100).toFixed(2)} / $${(ca.limitCents / 100).toFixed(2)} (${pctStr}%)`);
      }
    }

    lines.push('');

    if (tool.models.length > 0) {
      if (hasRequests && !hasCost) {
        const header = '  ' + 'Model'.padEnd(25) + 'Tokens'.padEnd(12) + 'Requests';
        lines.push(chalk.dim(header));
        for (const m of tool.models) {
          const row = '  ' +
            chalk.yellow(m.model.padEnd(25)) +
            formatTokenCount(m.inputTokens).padEnd(12) +
            String(m.numRequests ?? 0);
          lines.push(row);
        }
        lines.push('');
        lines.push(chalk.dim(`  Total: ${formatTokenCount(tool.totalInputTokens)} tokens / ${tool.totalRequests} requests`));
      } else {
        const header = '  ' + 'Model'.padEnd(25) + 'Input'.padEnd(12) + 'Output'.padEnd(12) + 'Cache W'.padEnd(12) + 'Cache R'.padEnd(12) + 'Cost';
        lines.push(chalk.dim(header));
        for (const m of tool.models) {
          const row = '  ' +
            chalk.yellow(m.model.padEnd(25)) +
            formatTokenCount(m.inputTokens).padEnd(12) +
            formatTokenCount(m.outputTokens).padEnd(12) +
            formatTokenCount(m.cacheWriteTokens).padEnd(12) +
            formatTokenCount(m.cacheReadTokens).padEnd(12) +
            chalk.green('$' + m.costUsd.toFixed(2));
          lines.push(row);
        }
        lines.push('');
        lines.push(chalk.dim(`  Total Tokens: ${formatTokenCount(tool.totalInputTokens)} in / ${formatTokenCount(tool.totalOutputTokens)} out`));
      }
    }

    if (tool.leaderboard) {
      const lb = tool.leaderboard;
      const rankLabel = chalk.dim('  Leaderboard');
      const rankVal = chalk.cyan(`#${lb.rank.toLocaleString()} / ${lb.totalUsers.toLocaleString()}`);
      lines.push(rankLabel + ' '.repeat(Math.max(1, 30 - 14)) + rankVal);
      lines.push(chalk.dim('  Accepted Diffs') + '          ' + lb.totalDiffAccepts.toLocaleString());
      const pct = (lb.acceptanceRatio * 100).toFixed(1);
      lines.push(chalk.dim('  Agent Lines') + '             ' + lb.composerLinesAccepted.toLocaleString() + ' / ' + lb.composerLinesSuggested.toLocaleString() + ` (${pct}%)`);
      lines.push(chalk.dim('  Favorite Model') + '          ' + chalk.yellow(lb.favoriteModel));
      lines.push('');
    }

    lines.push('');
    grandTotal += tool.totalCostUsd;
  }

  lines.push(chalk.dim('-'.repeat(45)));
  lines.push(`${chalk.bold('TOTAL')}${' '.repeat(35)}${chalk.bold.green('$' + grandTotal.toFixed(2))}`);

  return lines.join('\n');
}

export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
