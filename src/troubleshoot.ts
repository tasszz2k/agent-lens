import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanResult, ToolConfig, ConfigEntry, Diagnostic } from './types.js';

const STALE_DAYS = 180;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

function collectAllEntries(result: ScanResult): { entry: ConfigEntry; tc: ToolConfig }[] {
  const out: { entry: ConfigEntry; tc: ToolConfig }[] = [];
  for (const tc of [...result.global, ...result.project]) {
    for (const entry of tc.entries) {
      out.push({ entry, tc });
    }
  }
  return out;
}

export async function runChecks(result: ScanResult): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const all = collectAllEntries(result);

  for (const { entry } of all) {
    if (entry.symlink) {
      try {
        await fs.access(entry.symlink.resolved, fs.constants.R_OK);
      } catch {
        diagnostics.push({
          severity: 'error',
          code: 'broken-symlink',
          message: `Broken symlink: target does not exist`,
          path: entry.path,
          details: `Points to: ${entry.symlink.resolved}`,
        });
      }
    }
  }

  const canonical = result.global.filter((tc) => tc.tool === 'Canonical' && tc.category === 'Skills');
  const canonicalNames = new Set<string>();
  for (const tc of canonical) {
    for (const e of tc.entries) {
      canonicalNames.add(e.name);
    }
  }

  const claudeSkills = result.global.filter((tc) => tc.tool === 'Claude Code' && tc.category === 'Skills');
  const cursorSkills = result.global.filter((tc) => tc.tool === 'Cursor' && tc.category === 'Skills');
  const claudeNames = new Set<string>();
  const cursorNames = new Set<string>();
  for (const tc of claudeSkills) {
    for (const e of tc.entries) claudeNames.add(e.name);
  }
  for (const tc of cursorSkills) {
    for (const e of tc.entries) cursorNames.add(e.name);
  }

  for (const name of canonicalNames) {
    const inClaude = claudeNames.has(name);
    const inCursor = cursorNames.has(name);
    if (inClaude && !inCursor) {
      diagnostics.push({
        severity: 'warn',
        code: 'skill-gap',
        message: `Skill "${name}" is in Claude Code but missing from Cursor`,
        details: `Installed: Claude Code. Missing: Cursor`,
      });
    } else if (!inClaude && inCursor) {
      diagnostics.push({
        severity: 'warn',
        code: 'skill-gap',
        message: `Skill "${name}" is in Cursor but missing from Claude Code`,
        details: `Installed: Cursor. Missing: Claude Code`,
      });
    }
  }

  for (const { entry } of all) {
    if (!entry.exists) continue;
    try {
      const stat = await fs.stat(entry.path);
      const age = Date.now() - stat.mtimeMs;
      if (age > STALE_MS) {
        diagnostics.push({
          severity: 'warn',
          code: 'stale-config',
          message: `Config file not modified in over ${STALE_DAYS} days`,
          path: entry.path,
          details: `Last modified: ${new Date(stat.mtimeMs).toISOString()}`,
        });
      }
    } catch {
    }
  }

  const projectConfigs = result.project;
  const hasCursorrules = projectConfigs.some((tc) =>
    tc.entries.some((e) => e.path.endsWith('.cursorrules'))
  );
  const hasCursorRulesDir = projectConfigs.some((tc) =>
    tc.category === 'Rules' && tc.entries.some((e) => e.path.endsWith('.mdc'))
  );
  if (hasCursorrules && hasCursorRulesDir) {
    diagnostics.push({
      severity: 'warn',
      code: 'stale-config',
      message: 'Deprecated .cursorrules exists alongside .cursor/rules/*.mdc',
      path: result.projectPath,
      details: 'Consider migrating to .cursor/rules/ format',
    });
  }

  for (const { entry } of all) {
    if (!entry.exists) continue;
    try {
      await fs.access(entry.path, fs.constants.R_OK);
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';
      if (code === 'EACCES') {
        diagnostics.push({
          severity: 'info',
          code: 'permission-denied',
          message: 'Cannot read file (permission denied)',
          path: entry.path,
        });
      }
    }
  }

  const projectContextPaths: string[] = [];
  const projectRulesPaths: string[] = [];
  for (const tc of projectConfigs) {
    if (tc.category === 'Context') {
      for (const e of tc.entries) projectContextPaths.push(e.path);
    } else if (tc.category === 'Rules') {
      for (const e of tc.entries) projectRulesPaths.push(e.path);
    }
  }

  const hasClaudeMd = projectContextPaths.some((p) => p.endsWith('CLAUDE.md'));
  const hasAgentsMd = projectContextPaths.some((p) => p.endsWith('AGENTS.md'));
  if (hasClaudeMd && hasAgentsMd) {
    diagnostics.push({
      severity: 'info',
      code: 'conflict',
      message: 'Multiple context files: CLAUDE.md and AGENTS.md may conflict',
      path: result.projectPath,
      details: 'Claude CLI uses CLAUDE.md; multi-agent setups use AGENTS.md',
    });
  }

  const hasCursorrulesFile = projectRulesPaths.some((p) => p.endsWith('.cursorrules'));
  const hasMdcRules = projectRulesPaths.some((p) => p.endsWith('.mdc'));
  if (hasCursorrulesFile && hasMdcRules) {
    diagnostics.push({
      severity: 'info',
      code: 'conflict',
      message: 'Multiple rules sources: .cursorrules and .cursor/rules/*.mdc',
      path: result.projectPath,
      details: 'Both may be applied; consider consolidating',
    });
  }

  const mcpConfigs = [...result.global, ...result.project].filter(tc => tc.category === 'MCP Servers');
  const mcpUrlMap = new Map<string, string[]>();
  for (const tc of mcpConfigs) {
    for (const entry of tc.entries) {
      const url = entry.frontmatter?.url;
      if (typeof url === 'string') {
        const scope = result.project.includes(tc) ? ' (project)' : ' (global)';
        const tools = mcpUrlMap.get(url) ?? [];
        tools.push(`${tc.tool}${scope}`);
        mcpUrlMap.set(url, tools);
      }
    }
  }
  for (const [url, tools] of mcpUrlMap) {
    if (tools.length > 1) {
      diagnostics.push({
        severity: 'info',
        code: 'mcp-overlap',
        message: 'MCP server URL configured in multiple tools',
        path: url,
        details: `Found in: ${tools.join(', ')}`,
      });
    }
  }

  return diagnostics;
}

export function formatDiagnosticsForAI(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => {
      const severity = d.severity.toUpperCase();
      const lines = [`[${severity}] (${d.code}) ${d.message}`];
      if (d.path) lines.push(`  Path: ${d.path}`);
      if (d.details) lines.push(`  Details: ${d.details}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
