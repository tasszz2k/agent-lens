import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ScanResult, ToolConfig, ConfigEntry, McpServerEntry, ProjectScan } from './types.js';
import { traceSymlink } from './symlink.js';
import { parseFrontmatter, parseSkillFile, parseMdcFile, parseCommandFile, getFileInfo, parseMcpJson, parseMcpToml, parseHooksFromSettings, parseCursorUserRules } from './parse.js';

export interface WhereResult {
  canonicalSkills: ConfigEntry[];
  installations: WhereInstallation[];
}

export interface WhereInstallation {
  skillName: string;
  location: string;
  tool: string;
  scope: 'global' | 'project';
  projectPath?: string;
  entry: ConfigEntry;
}

function tildify(p: string): string {
  const home = os.homedir();
  if (p === home || p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    return name.endsWith(pattern.slice(1));
  }
  return name === pattern;
}

function matchesPatterns(name: string, patterns: string | string[]): boolean {
  if (typeof patterns === 'string') return matchesPattern(name, patterns);
  return patterns.some((p) => matchesPattern(name, p));
}

type ParseMode = 'command' | 'mdc' | 'frontmatter';

export async function scanDirectory(
  dirPath: string,
  filePattern: string | string[],
  parseMode: ParseMode = 'frontmatter',
  recursive = false
): Promise<ConfigEntry[]> {
  const entries: ConfigEntry[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirEntries) {
      const fullPath = path.join(dir, dirent.name);
      if (recursive && dirent.isDirectory()) {
        await walk(fullPath, prefix ? `${prefix}/${dirent.name}` : dirent.name);
        continue;
      }
      if (!matchesPatterns(dirent.name, filePattern)) continue;
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const symlink = await traceSymlink(fullPath);
      let frontmatter: Record<string, unknown> | undefined;
      let description: string | undefined;

      if (parseMode === 'mdc') {
        const parsed = await parseMdcFile(fullPath);
        frontmatter = Object.keys(parsed.frontmatter).length > 0 ? parsed.frontmatter : undefined;
        description = parsed.description;
      } else if (parseMode === 'command') {
        const parsed = await parseCommandFile(fullPath);
        frontmatter = Object.keys(parsed.frontmatter).length > 0 ? parsed.frontmatter : undefined;
        description = parsed.description;
      } else {
        const parsed = await parseFrontmatter(fullPath);
        frontmatter = Object.keys(parsed.frontmatter).length > 0 ? parsed.frontmatter : undefined;
        description = parsed.description;
      }

      const baseName = path.basename(dirent.name, path.extname(dirent.name));
      entries.push({
        name: prefix ? `${prefix}/${baseName}` : baseName,
        path: fullPath,
        exists: true,
        symlink,
        frontmatter,
        description,
      });
    }
  }

  await walk(dirPath, '');
  return entries;
}

export async function scanSkillsDir(dirPath: string, excludeDirs: string[] = []): Promise<ConfigEntry[]> {
  const entries: ConfigEntry[] = [];
  try {
    const subdirs = await fs.readdir(dirPath, { withFileTypes: true });
    for (const dirent of subdirs) {
      if (excludeDirs.includes(dirent.name)) continue;
      const isDir = dirent.isDirectory() || dirent.isSymbolicLink();
      if (!isDir) continue;
      const subdirPath = path.join(dirPath, dirent.name);
      try {
        const realStat = await fs.stat(subdirPath);
        if (!realStat.isDirectory()) continue;
      } catch {
        continue;
      }
      const skillMdPath = path.join(subdirPath, 'SKILL.md');

      let stat;
      try {
        stat = await fs.stat(skillMdPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const dirSymlink = await traceSymlink(subdirPath);
      const fileSymlink = await traceSymlink(skillMdPath);
      const symlink = fileSymlink ?? dirSymlink;

      const parsed = await parseSkillFile(skillMdPath);
      entries.push({
        name: dirent.name,
        path: skillMdPath,
        exists: true,
        symlink,
        frontmatter: Object.keys(parsed.frontmatter).length > 0 ? parsed.frontmatter : undefined,
        description: parsed.description ?? parsed.name,
      });
    }
  } catch {
    return [];
  }
  return entries;
}

export async function scanSingleFile(filePath: string): Promise<ConfigEntry | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const symlink = await traceSymlink(filePath);
  const info = await getFileInfo(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    exists: info.exists,
    symlink,
  };
}

async function toolConfig(
  tool: string,
  category: string,
  basePath: string,
  label: string | undefined,
  entries: ConfigEntry[]
): Promise<ToolConfig> {
  let exists = false;
  try {
    await fs.stat(basePath);
    exists = true;
  } catch {
  }
  return {
    tool,
    category,
    label,
    basePath,
    exists,
    entries,
  };
}

async function findPluginSkills(dir: string, results: ToolConfig[], depth = 0, tool = 'Cursor'): Promise<void> {
  if (depth > 4) return;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const full = path.join(dir, dirent.name);
      if (dirent.name === 'skills') {
        const segments = full.split(path.sep);
        const cacheIdx = segments.indexOf('cache');
        const pluginLabel = cacheIdx >= 0 && cacheIdx + 2 < segments.length
          ? segments.slice(cacheIdx + 1, cacheIdx + 3).join('/')
          : path.basename(path.dirname(full));
        const skillEntries = await scanSkillsDir(full);
        if (skillEntries.length > 0) {
          results.push(await toolConfig(tool, 'Skills', full, `(plugin: ${pluginLabel})`, skillEntries));
        }
      } else {
        await findPluginSkills(full, results, depth + 1, tool);
      }
    }
  } catch {
  }
}

async function scanMcpFile(filePath: string, parseMode: 'json' | 'toml' | 'claude-global'): Promise<ConfigEntry[]> {
  let servers: McpServerEntry[];
  if (parseMode === 'toml') {
    servers = await parseMcpToml(filePath);
  } else {
    servers = await parseMcpJson(filePath);
  }
  return servers.map((s) => ({
    name: s.name,
    path: filePath,
    exists: true,
    description: formatMcpDescription(s),
    frontmatter: {
      type: s.type,
      ...(s.url ? { url: s.url } : {}),
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {}),
      hasAuth: s.hasAuth,
    },
  }));
}

function formatMcpDescription(s: McpServerEntry): string {
  if (s.type === 'http') {
    const auth = s.hasAuth ? ' [auth]' : '';
    return `(http) ${s.url ?? 'unknown'}${auth}`;
  }
  const cmd = [s.command, ...(s.args ?? [])].join(' ');
  const auth = s.hasAuth ? ' [auth]' : '';
  return `(stdio) ${cmd}${auth}`;
}

function cursorUserDataPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export async function scanGlobal(): Promise<ToolConfig[]> {
  const home = os.homedir();
  const results: ToolConfig[] = [];

  const locations: Array<{
    tool: string;
    category: string;
    path: string;
    label?: string;
    type: 'skills' | 'commands' | 'context' | 'rules' | 'plugins' | 'mcp' | 'mcp-toml' | 'hooks' | 'cursor-user-rules' | 'codex-rules';
    excludeSystem?: boolean;
  }> = [
    { tool: 'Canonical', category: 'Skills', path: path.join(home, '.agents', 'skills'), type: 'skills' },
    { tool: 'Claude Code', category: 'Skills', path: path.join(home, '.claude', 'skills'), type: 'skills' },
    { tool: 'Claude Code', category: 'Commands', path: path.join(home, '.claude', 'commands'), type: 'commands' },
    { tool: 'Claude Code', category: 'Context', path: path.join(home, '.claude', 'CLAUDE.md'), type: 'context' },
    { tool: 'Cursor', category: 'Skills', path: path.join(home, '.cursor', 'skills'), label: '(user)', type: 'skills' },
    { tool: 'Cursor', category: 'Skills', path: path.join(home, '.cursor', 'skills-cursor'), label: '(built-in)', type: 'skills' },
    { tool: 'Cursor', category: 'Rules', path: path.join(home, '.cursor', 'rules'), type: 'rules' },
    { tool: 'Cursor', category: 'Context', path: cursorUserDataPath(), label: '(user rules)', type: 'cursor-user-rules' },
    { tool: 'Codex', category: 'Skills', path: path.join(home, '.codex', 'skills'), type: 'skills', excludeSystem: true },
    { tool: 'Codex', category: 'Skills', path: path.join(home, '.codex', 'skills', '.system'), label: '(system)', type: 'skills' },
    { tool: 'Codex', category: 'Rules', path: path.join(home, '.codex', 'rules'), type: 'codex-rules' },
    { tool: 'Claude Code', category: 'Hooks', path: path.join(home, '.claude', 'settings.json'), type: 'hooks' },
    { tool: 'Cursor', category: 'MCP Servers', path: path.join(home, '.cursor', 'mcp.json'), type: 'mcp' },
    { tool: 'Claude Code', category: 'MCP Servers', path: path.join(home, '.claude.json'), type: 'mcp' },
    { tool: 'Codex', category: 'MCP Servers', path: path.join(home, '.codex', 'config.toml'), type: 'mcp-toml' },
  ];

  for (const loc of locations) {
    try {
      if (loc.type === 'skills') {
        const entries = await scanSkillsDir(loc.path, loc.excludeSystem ? ['.system'] : []);
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'commands') {
        const entries = await scanDirectory(loc.path, '*.md', 'command');
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'context') {
        const entry = await scanSingleFile(loc.path);
        results.push(await toolConfig(loc.tool, loc.category, path.dirname(loc.path), loc.label, entry ? [entry] : []));
      } else if (loc.type === 'rules') {
        const entries = await scanDirectory(loc.path, ['*.mdc', '*.md'], 'mdc', true);
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'cursor-user-rules') {
        const entries = await parseCursorUserRules(loc.path);
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'codex-rules') {
        const entries = await scanDirectory(loc.path, '*', 'frontmatter');
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'mcp') {
        const entries = await scanMcpFile(loc.path, 'json');
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'mcp-toml') {
        const entries = await scanMcpFile(loc.path, 'toml');
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      } else if (loc.type === 'hooks') {
        const entries = await parseHooksFromSettings(loc.path);
        results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, entries));
      }
    } catch {
      results.push(await toolConfig(loc.tool, loc.category, loc.path, loc.label, []));
    }
  }

  try {
    const pluginsPath = path.join(home, '.cursor', 'plugins', 'cache');
    await findPluginSkills(pluginsPath, results);
  } catch {
  }

  try {
    const claudePluginsPath = path.join(home, '.claude', 'plugins', 'cache');
    await findPluginSkills(claudePluginsPath, results, 0, 'Claude Code');
  } catch {
  }

  return results;
}

export async function scanProject(projectPath: string): Promise<ToolConfig[]> {
  const results: ToolConfig[] = [];

  const projectLocations: Array<{
    tool: string;
    category: string;
    path: string;
    type: 'skills' | 'commands' | 'context' | 'rules' | 'mcp' | 'hooks';
  }> = [
    { tool: 'Canonical', category: 'Skills', path: path.join(projectPath, '.agents', 'skills'), type: 'skills' },
    { tool: 'Claude Code', category: 'Skills', path: path.join(projectPath, '.claude', 'skills'), type: 'skills' },
    { tool: 'Claude Code', category: 'Commands', path: path.join(projectPath, '.claude', 'commands'), type: 'commands' },
    { tool: 'Claude Code', category: 'Context', path: path.join(projectPath, 'CLAUDE.md'), type: 'context' },
    { tool: 'Claude Code', category: 'Context', path: path.join(projectPath, '.claude', 'CLAUDE.md'), type: 'context' },
    { tool: 'Cursor', category: 'Rules', path: path.join(projectPath, '.cursorrules'), type: 'rules' },
    { tool: 'Cursor', category: 'Rules', path: path.join(projectPath, '.cursor', 'rules'), type: 'rules' },
    { tool: 'Cursor', category: 'Skills', path: path.join(projectPath, '.cursor', 'skills'), type: 'skills' },
    { tool: 'Multi-agent', category: 'Context', path: path.join(projectPath, 'AGENTS.md'), type: 'context' },
    { tool: 'Copilot', category: 'Context', path: path.join(projectPath, '.github', 'copilot-instructions.md'), type: 'context' },
    { tool: 'Claude Code', category: 'Hooks', path: path.join(projectPath, '.claude', 'settings.json'), type: 'hooks' },
    { tool: 'Claude Code', category: 'Hooks', path: path.join(projectPath, '.claude', 'settings.local.json'), type: 'hooks' },
    { tool: 'Claude Code', category: 'MCP Servers', path: path.join(projectPath, '.mcp.json'), type: 'mcp' },
    { tool: 'Cursor', category: 'MCP Servers', path: path.join(projectPath, '.cursor', 'mcp.json'), type: 'mcp' },
    { tool: 'Copilot', category: 'MCP Servers', path: path.join(projectPath, '.vscode', 'mcp.json'), type: 'mcp' },
  ];

  for (const loc of projectLocations) {
    try {
      const stat = await fs.stat(loc.path);
      if (loc.type === 'skills' && stat.isDirectory()) {
        const entries = await scanSkillsDir(loc.path);
        results.push(await toolConfig(loc.tool, loc.category, loc.path, undefined, entries));
      } else if (loc.type === 'commands' && stat.isDirectory()) {
        const entries = await scanDirectory(loc.path, '*.md', 'command');
        results.push(await toolConfig(loc.tool, loc.category, loc.path, undefined, entries));
      } else if (loc.type === 'context' && stat.isFile()) {
        const entry = await scanSingleFile(loc.path);
        if (entry) {
          results.push(await toolConfig(loc.tool, loc.category, path.dirname(loc.path), undefined, [entry]));
        }
      } else if (loc.type === 'rules') {
        if (stat.isFile()) {
          const entry = await scanSingleFile(loc.path);
          if (entry) {
            results.push(await toolConfig(loc.tool, loc.category, projectPath, undefined, [entry]));
          }
        } else if (stat.isDirectory()) {
          const entries = await scanDirectory(loc.path, ['*.mdc', '*.md'], 'mdc', true);
          results.push(await toolConfig(loc.tool, loc.category, loc.path, undefined, entries));
        }
      } else if (loc.type === 'mcp' && stat.isFile()) {
        const entries = await scanMcpFile(loc.path, 'json');
        if (entries.length > 0) {
          results.push(await toolConfig(loc.tool, loc.category, loc.path, undefined, entries));
        }
      } else if (loc.type === 'hooks' && stat.isFile()) {
        const entries = await parseHooksFromSettings(loc.path);
        if (entries.length > 0) {
          results.push(await toolConfig(loc.tool, loc.category, loc.path, undefined, entries));
        }
      }
    } catch {
    }
  }

  return results;
}

export async function scanAll(projectPath: string, includeGlobal: boolean): Promise<ScanResult> {
  const { loadConfig, discoverProjects } = await import('./config.js');
  const config = await loadConfig();

  const [global, project, discoveredPaths] = await Promise.all([
    includeGlobal ? scanGlobal() : [],
    scanProject(projectPath),
    config.roots.length > 0 ? discoverProjects(config.roots) : Promise.resolve([]),
  ]);

  const normalizedCurrent = path.normalize(path.resolve(projectPath));
  const otherPaths = discoveredPaths.filter(
    (p) => path.normalize(p) !== normalizedCurrent
  );

  let projects: ProjectScan[] | undefined;
  if (otherPaths.length > 0) {
    const scans = await Promise.all(
      otherPaths.map(async (p) => ({
        path: p,
        configs: await scanProject(p),
      }))
    );
    projects = scans.filter((s) => s.configs.length > 0);
    if (projects.length === 0) projects = undefined;
  }

  return {
    global,
    project,
    projectPath,
    projects,
  };
}

function skillDirFromEntry(entry: ConfigEntry): string {
  return path.dirname(path.dirname(entry.path));
}

export async function scanForWhereCommand(
  skillName?: string,
  projectPath: string = process.cwd()
): Promise<WhereResult> {
  const home = os.homedir();
  const canonicalPath = path.join(home, '.agents', 'skills');
  let canonicalSkills: ConfigEntry[] = [];

  try {
    canonicalSkills = await scanSkillsDir(canonicalPath);
    if (skillName) {
      canonicalSkills = canonicalSkills.filter((e) => e.name === skillName);
    }
  } catch {
  }

  const installations: WhereInstallation[] = [];
  const [globalConfigs, projectConfigs] = await Promise.all([
    scanGlobal(),
    scanProject(projectPath),
  ]);
  const globalSkills = globalConfigs.filter((c) => c.category === 'Skills');
  const projectSkills = projectConfigs.filter((c) => c.category === 'Skills');

  for (const canonical of canonicalSkills) {
    const canonicalName = canonical.name;
    for (const tc of globalSkills) {
      for (const entry of tc.entries) {
        if (entry.name !== canonicalName) continue;
        const location = skillDirFromEntry(entry);
        installations.push({
          skillName: canonicalName,
          location: tildify(location),
          tool: tc.tool,
          scope: 'global',
          entry,
        });
      }
    }
    for (const tc of projectSkills) {
      for (const entry of tc.entries) {
        if (entry.name !== canonicalName) continue;
        const location = skillDirFromEntry(entry);
        installations.push({
          skillName: canonicalName,
          location: tildify(location),
          tool: tc.tool,
          scope: 'project',
          projectPath,
          entry,
        });
      }
    }
  }

  return { canonicalSkills, installations };
}
