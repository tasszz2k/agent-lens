import chalk from 'chalk';
import path from 'node:path';
import os from 'node:os';
import type { ScanResult, ToolConfig, ConfigEntry, Diagnostic } from './types.js';
import type { WhereInstallation } from './scan.js';
import { matchesDisabledCategory } from './config.js';

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
    const label = chalk.bold.white('Canonical Store');
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

  const toolName = chalk.bold.white(configs[0].tool);
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
        const toolLabel = chalk.bold.white(tc.tool) + labelExtra;
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

export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
