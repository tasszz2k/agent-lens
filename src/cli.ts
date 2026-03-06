#!/usr/bin/env node

import { Command } from 'commander';
import { scanAll, scanForWhereCommand } from './scan.js';
import { loadConfig, saveConfig, addRoot, removeRoot, discoverProjects, getConfigPath } from './config.js';
import { runChecks } from './troubleshoot.js';
import { analyzeWithClaude, isClaudeAvailable } from './ai.js';
import { formatDiagnosticsForAI } from './troubleshoot.js';
import { renderStatic, renderDiagnostics, renderWhereResult, renderJson } from './render.js';
import type { Diagnostic } from './types.js';

const program = new Command();

program
  .name('agentlens')
  .description('Analyze agent configuration files across AI coding tools')
  .version('0.1.0');

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
      const instance = render(
        React.createElement(App, {
          scanResult: result,
          diagnostics,
          mode: 'scan',
        })
      );
      instance.waitUntilExit().then(() => {
        process.stdout.write('\x1b[?1049l');
      });
    } else {
      console.log(renderStatic(result));
      await runDiagnosticsAndAI(diagnostics, opts.ai === false);
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

program
  .command('config')
  .description('Manage agentlens configuration')
  .option('--add-root <path>', 'Add a workspace root directory')
  .option('--remove-root <path>', 'Remove a workspace root directory')
  .option('--list-roots', 'List configured root directories')
  .action(async (opts) => {
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
  });

program.parse();
