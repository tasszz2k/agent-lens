#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { scanAll, scanForWhereCommand } from './scan.js';
import { loadConfig, saveConfig, addRoot, removeRoot, setToolEnabled as configSetToolEnabled, setCategoryEnabled as configSetCategoryEnabled, setCursorToken, setCursorTeamId, setClaudeSessionToken, setClaudeOrgId, LABEL_CATEGORIES, discoverProjects, getConfigPath } from './config.js';
import { runChecks } from './troubleshoot.js';
import { analyzeWithClaude, isClaudeAvailable } from './ai.js';
import { formatDiagnosticsForAI } from './troubleshoot.js';
import { renderStatic, renderDiagnostics, renderWhereResult, renderJson } from './render.js';
import type { Diagnostic } from './types.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('agentlens')
  .description('Analyze agent configuration files across AI coding tools')
  .version(version);

async function runDiagnosticsAndAI(
  diagnostics: Diagnostic[],
  noAi: boolean
): Promise<void> {
  if (diagnostics.length === 0) return;
  console.log();
  console.log(renderDiagnostics(diagnostics));
  if (!noAi) {
    const available = await isClaudeAvailable();
    if (available) {
      console.log();
      console.log('AI ANALYSIS');
      console.log();
      await analyzeWithClaude(diagnostics);
    }
  }
}

program
  .command('scan', { isDefault: true })
  .description('Scan and display agent configuration tree')
  .option('-p, --project <path>', 'Project directory to scan', process.cwd())
  .option('--no-global', 'Skip global config scanning')
  .option('--no-ai', 'Skip AI analysis even if issues found')
  .option('--json', 'Output JSON instead of diagram')
  .action(async (opts) => {
    const projectPath = opts.project;
    const includeGlobal = opts.global !== false;
    const result = await scanAll(projectPath, includeGlobal);
    const diagnostics = await runChecks(result);

    if (opts.json) {
      console.log(renderJson({ scan: result, diagnostics }));
      return;
    }

    const isTTY = process.stdout.isTTY;
    if (isTTY && !opts.json) {
      process.stdout.write('\x1b[?1049h');
      process.stdout.write('\x1b[H');
      const { render } = await import('ink');
      const React = await import('react');
      const { default: App } = await import('./ui/App.js');
      const config = await loadConfig();
      const instance = render(
        React.createElement(App, {
          scanResult: result,
          diagnostics,
          mode: 'scan',
          initialDisabledTools: config.disabledTools,
          initialDisabledCategories: config.disabledCategories,
          configRoots: config.roots,
          hasCursorToken: !!config.cursorSessionToken,
          hasClaudeSessionToken: !!config.claudeSessionToken,
          version,
        })
      );
      instance.waitUntilExit().then(() => {
        process.stdout.write('\x1b[?1049l');
      });
    } else {
      const config = await loadConfig();
      console.log(renderStatic(result, config.disabledTools, config.disabledCategories));
      await runDiagnosticsAndAI(diagnostics, opts.ai === false);
    }
  });

program
  .command('cost')
  .description('Show agent usage cost dashboard')
  .option('--json', 'Output JSON instead of formatted text')
  .option('--no-cursor', 'Skip Cursor API (only show Claude Code costs)')
  .option('--no-claude-ai', 'Skip Claude.ai costs')
  .action(async (opts) => {
    const { fetchAllCosts, fetchClaudeCodeCosts, fetchClaudeAiCosts } = await import('./cost.js');

    const skipCursor = opts.cursor === false;
    const skipClaudeAi = opts.claudeAi === false;

    async function buildReport() {
      if (!skipCursor && !skipClaudeAi) return fetchAllCosts();
      const fetchers: Promise<import('./types.js').ToolCostSummary>[] = [];
      if (!skipClaudeAi) fetchers.push(fetchClaudeAiCosts());
      fetchers.push(fetchClaudeCodeCosts());
      if (!skipCursor) {
        const { fetchCursorCosts } = await import('./cost.js');
        fetchers.push(fetchCursorCosts());
      }
      const results = await Promise.allSettled(fetchers);
      const now = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return {
        tools: results.map((r) => r.status === 'fulfilled' ? r.value : { tool: 'Unknown', totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, models: [] as import('./types.js').ModelCostBreakdown[], period: '', error: (r.reason as Error)?.message ?? String(r.reason) }),
        month: `${monthNames[now.getMonth()]} ${now.getFullYear()}`,
        monthStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
        fetchedAt: now.toISOString(),
      };
    }

    if (opts.json) {
      const report = await buildReport();
      console.log(renderJson(report));
      return;
    }

    const isTTY = process.stdout.isTTY;
    if (isTTY) {
      process.stdout.write('\x1b[?1049h');
      process.stdout.write('\x1b[H');
      const { render } = await import('ink');
      const React = await import('react');
      const { default: App } = await import('./ui/App.js');
      const config = await loadConfig();
      const result = await scanAll(process.cwd(), true);
      const diagnostics = await runChecks(result);
      const instance = render(
        React.createElement(App, {
          scanResult: result,
          diagnostics,
          mode: 'scan',
          initialDisabledTools: config.disabledTools,
          initialDisabledCategories: config.disabledCategories,
          initialPage: 'cost',
          configRoots: config.roots,
          hasCursorToken: !!config.cursorSessionToken,
          hasClaudeSessionToken: !!config.claudeSessionToken,
          version,
        })
      );
      instance.waitUntilExit().then(() => {
        process.stdout.write('\x1b[?1049l');
      });
    } else {
      const { renderCostStatic } = await import('./render.js');
      const report = await buildReport();
      console.log(renderCostStatic(report));
    }
  });

program
  .command('where [name]')
  .description('Trace where canonical skills are installed')
  .option('--no-ai', 'Skip AI analysis even if issues found')
  .option('--json', 'Output JSON instead of diagram')
  .action(async (name: string | undefined, opts) => {
    const config = await loadConfig();
    const projects = await discoverProjects(config.roots);

    const whereResult = await scanForWhereCommand(name);

    if (opts.json) {
      console.log(renderJson(whereResult));
      return;
    }

    console.log();
    if (name) {
      console.log(`Tracing skill: ${name}`);
    } else {
      console.log('Tracing all canonical skills');
    }
    console.log();
    console.log(renderWhereResult(whereResult.canonicalSkills, whereResult.installations));

    const fullResult = await scanAll(process.cwd(), true);
    const diagnostics = await runChecks(fullResult);
    await runDiagnosticsAndAI(diagnostics, opts.ai === false);
  });

program
  .command('troubleshoot')
  .description('Run comprehensive health checks with AI analysis')
  .option('-p, --project <path>', 'Project directory to check', process.cwd())
  .option('--no-ai', 'Skip Claude Code analysis')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const projectPath = opts.project;
    console.log('Scanning...');
    console.log();

    const result = await scanAll(projectPath, true);
    const diagnostics = await runChecks(result);

    if (opts.json) {
      console.log(renderJson({ scan: result, diagnostics }));
      return;
    }

    if (diagnostics.length === 0) {
      console.log('No issues found. Configuration looks healthy.');
      return;
    }

    console.log(renderDiagnostics(diagnostics));

    if (opts.ai !== false) {
      const available = await isClaudeAvailable();
      if (available) {
        console.log();
        console.log('AI ANALYSIS');
        console.log();
        await analyzeWithClaude(diagnostics, formatDiagnosticsForAI(diagnostics));
      } else {
        console.log();
        console.log('Install Claude Code CLI for AI-powered analysis: https://docs.anthropic.com/en/docs/claude-code');
      }
    }
  });

const configCmd = program
  .command('config')
  .description('Manage agentlens configuration')
  .option('--add-root <path>', 'Add a workspace root directory')
  .option('--remove-root <path>', 'Remove a workspace root directory')
  .option('--list-roots', 'List configured root directories')
  .option('--set-cursor-token <token>', 'Set Cursor session token for cost tracking')
  .option('--clear-cursor-token', 'Remove stored Cursor session token')
  .option('--set-cursor-team-id <id>', 'Set Cursor team ID for leaderboard (from cursor.com dashboard)')
  .option('--clear-cursor-team-id', 'Remove Cursor team ID')
  .option('--set-claude-session-token <token>', 'Set Claude.ai session token for cost tracking')
  .option('--clear-claude-session-token', 'Remove stored Claude.ai session token')
  .option('--set-claude-org-id <id>', 'Set Claude.ai organization UUID')
  .option('--clear-claude-org-id', 'Remove Claude.ai organization UUID')
  .action(async (opts) => {
    if (opts.setCursorToken) {
      await setCursorToken(opts.setCursorToken);
      console.log('Cursor session token saved.');
      console.log('Run "agentlens cost" to view your Cursor usage costs.');
      return;
    }

    if (opts.clearCursorToken) {
      await setCursorToken(undefined);
      console.log('Cursor session token removed.');
      return;
    }

    if (opts.setCursorTeamId) {
      const teamId = parseInt(opts.setCursorTeamId, 10);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        console.error('Invalid team ID. Must be a positive integer.');
        console.error('Find it at: cursor.com/dashboard > DevTools (F12) > Application > Cookies > team_id');
        return;
      }
      await setCursorTeamId(teamId);
      console.log(`Cursor team ID saved: ${teamId}`);
      console.log('Email will be auto-detected from Cursor. Leaderboard will appear on the cost page.');
      return;
    }

    if (opts.clearCursorTeamId) {
      await setCursorTeamId(undefined);
      console.log('Cursor team ID removed.');
      return;
    }

    if (opts.setClaudeSessionToken) {
      await setClaudeSessionToken(opts.setClaudeSessionToken);
      console.log('Claude.ai session token saved.');
      console.log('Run "agentlens cost" to view your Claude.ai usage costs.');
      return;
    }

    if (opts.clearClaudeSessionToken) {
      await setClaudeSessionToken(undefined);
      console.log('Claude.ai session token removed.');
      return;
    }

    if (opts.setClaudeOrgId) {
      await setClaudeOrgId(opts.setClaudeOrgId);
      console.log(`Claude.ai organization ID saved: ${opts.setClaudeOrgId}`);
      return;
    }

    if (opts.clearClaudeOrgId) {
      await setClaudeOrgId(undefined);
      console.log('Claude.ai organization ID removed.');
      return;
    }

    if (opts.addRoot) {
      const config = await addRoot(opts.addRoot);
      console.log(`Added root: ${opts.addRoot}`);
      console.log(`Total roots: ${config.roots.length}`);
      return;
    }

    if (opts.removeRoot) {
      const config = await removeRoot(opts.removeRoot);
      console.log(`Removed root: ${opts.removeRoot}`);
      console.log(`Total roots: ${config.roots.length}`);
      return;
    }

    const config = await loadConfig();
    console.log(`Config: ${getConfigPath()}`);
    console.log();
    if (config.roots.length === 0) {
      console.log('No workspace roots configured.');
      console.log('Add one with: agentlens config --add-root <path>');
    } else {
      console.log('Workspace roots:');
      for (const root of config.roots) {
        console.log(`  ${root}`);
      }
    }
    console.log();
    const disabled = config.disabledTools ?? [];
    if (disabled.length > 0) {
      console.log('Disabled tools:');
      for (const t of disabled) {
        console.log(`  ${t}`);
      }
    } else {
      console.log('All tools enabled.');
    }
    console.log();
    console.log('Manage tools: agentlens config tools');
  });

configCmd
  .command('tools')
  .description('Manage tool and category visibility filters')
  .option('--enable <name>', 'Enable a tool or category')
  .option('--disable <name>', 'Disable a tool or category')
  .action(async (opts) => {
    const knownTools = ['Canonical', 'Claude Code', 'Cursor', 'Codex', 'Copilot', 'Multi-agent'];
    const categoryIds = LABEL_CATEGORIES.map((c) => c.id);

    if (opts.enable) {
      if (categoryIds.includes(opts.enable)) {
        await configSetCategoryEnabled(opts.enable, true);
      } else {
        await configSetToolEnabled(opts.enable, true);
      }
      console.log(`Enabled: ${opts.enable}`);
      return;
    }
    if (opts.disable) {
      if (categoryIds.includes(opts.disable)) {
        await configSetCategoryEnabled(opts.disable, false);
      } else {
        await configSetToolEnabled(opts.disable, false);
      }
      console.log(`Disabled: ${opts.disable}`);
      return;
    }

    const config = await loadConfig();
    const disabledTools = new Set(config.disabledTools ?? []);
    const disabledCats = new Set(config.disabledCategories ?? []);

    console.log('Tools:');
    for (const tool of knownTools) {
      const status = disabledTools.has(tool) ? '[ ]' : '[x]';
      console.log(`  ${status} ${tool}`);
    }
    console.log();
    console.log('Categories:');
    for (const cat of LABEL_CATEGORIES) {
      const status = disabledCats.has(cat.id) ? '[ ]' : '[x]';
      console.log(`  ${status} ${cat.label} (${cat.id})`);
    }
    console.log();
    console.log('Usage:');
    console.log('  agentlens config tools --enable "Codex"');
    console.log('  agentlens config tools --disable "plugin"');
  });

program.parse();
