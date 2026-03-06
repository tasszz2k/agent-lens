import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import { parse as parseToml } from 'smol-toml';
import type { ConfigEntry, McpServerEntry } from './types.js';

const execFileAsync = promisify(execFile);

export interface ParsedFile {
  path: string;
  frontmatter: Record<string, unknown>;
  description?: string;
  name?: string;
  body: string;
  lineCount: number;
}

export interface FileInfo {
  path: string;
  exists: boolean;
  size: number;
  mtime: Date;
  lineCount: number;
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function statSafe(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function parseFrontmatterManual(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
}

function parseResultToParsedFile(
  filePath: string,
  result: matter.GrayMatterFile<string>,
  extra?: { description?: string; name?: string }
): ParsedFile {
  const body = result.content.trim();
  const lineCount = body ? body.split(/\n/).length : 0;
  return {
    path: filePath,
    frontmatter: result.data as Record<string, unknown>,
    body,
    lineCount,
    ...extra,
  };
}

export async function parseFrontmatter(filePath: string): Promise<ParsedFile> {
  const content = await readFileSafe(filePath);
  if (!content) {
    return {
      path: filePath,
      frontmatter: {},
      body: '',
      lineCount: 0,
    };
  }
  const result = matter(content);
  return parseResultToParsedFile(filePath, result);
}

export async function parseSkillFile(filePath: string): Promise<ParsedFile> {
  const content = await readFileSafe(filePath);
  if (!content) {
    return {
      path: filePath,
      frontmatter: {},
      body: '',
      lineCount: 0,
    };
  }
  const result = matter(content);
  const fm = result.data as Record<string, unknown>;
  return parseResultToParsedFile(filePath, result, {
    name: typeof fm.name === 'string' ? fm.name : undefined,
    description: typeof fm.description === 'string' ? fm.description : undefined,
  });
}

export async function parseMdcFile(filePath: string): Promise<ParsedFile> {
  const content = await readFileSafe(filePath);
  if (!content) {
    return {
      path: filePath,
      frontmatter: {},
      body: '',
      lineCount: 0,
    };
  }
  try {
    const result = matter(content);
    const fm = result.data as Record<string, unknown>;
    return parseResultToParsedFile(filePath, result, {
      description: typeof fm.description === 'string' ? fm.description : undefined,
    });
  } catch {
    const fm = parseFrontmatterManual(content);
    const bodyStart = content.indexOf('---', 3);
    const body = bodyStart >= 0 ? content.slice(bodyStart + 3).trim() : content.trim();
    const lineCount = body ? body.split(/\n/).length : 0;
    return {
      path: filePath,
      frontmatter: fm,
      body,
      lineCount,
      description: typeof fm.description === 'string' ? fm.description : undefined,
    };
  }
}

export async function parseCommandFile(filePath: string): Promise<ParsedFile> {
  const content = await readFileSafe(filePath);
  if (!content) {
    return {
      path: filePath,
      frontmatter: {},
      body: '',
      lineCount: 0,
    };
  }
  const result = matter(content);
  const fm = result.data as Record<string, unknown>;
  return parseResultToParsedFile(filePath, result, {
    name: typeof fm.name === 'string' ? fm.name : undefined,
    description: typeof fm.description === 'string' ? fm.description : undefined,
  });
}

export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const stats = await statSafe(filePath);
  if (!stats) {
    return {
      path: filePath,
      exists: false,
      size: 0,
      mtime: new Date(0),
      lineCount: 0,
    };
  }
  const content = await readFileSafe(filePath);
  const lineCount = content ? content.split(/\n/).length : 0;
  return {
    path: filePath,
    exists: true,
    size: stats.size,
    mtime: stats.mtime,
    lineCount,
  };
}

function hasAuthInEntry(entry: Record<string, unknown>): boolean {
  const headers = entry.headers as Record<string, string> | undefined;
  if (headers && typeof headers === 'object') {
    for (const v of Object.values(headers)) {
      if (typeof v === 'string' && v.trim().length > 0) return true;
    }
  }
  const env = entry.env as Record<string, string> | undefined;
  if (env && typeof env === 'object') {
    for (const k of Object.keys(env)) {
      const upper = k.toUpperCase();
      if (
        (upper.includes('TOKEN') ||
          upper.includes('SECRET') ||
          upper.includes('KEY') ||
          upper.includes('PASSWORD')) &&
        typeof env[k] === 'string' &&
        (env[k] as string).trim().length > 0
      ) {
        return true;
      }
    }
  }
  if (entry.oauth !== undefined && entry.oauth !== null) return true;
  return false;
}

function serverEntryToMcp(
  name: string,
  entry: Record<string, unknown>
): McpServerEntry | null {
  const hasUrl = typeof entry.url === 'string' && entry.url.length > 0;
  const hasCommand = typeof entry.command === 'string' && entry.command.length > 0;
  if (!hasUrl && !hasCommand) return null;
  const type: 'http' | 'stdio' = hasUrl ? 'http' : 'stdio';
  const result: McpServerEntry = {
    name,
    type,
    hasAuth: hasAuthInEntry(entry),
  };
  if (hasUrl) result.url = entry.url as string;
  if (hasCommand) result.command = entry.command as string;
  if (Array.isArray(entry.args)) result.args = entry.args as string[];
  return result;
}

function collectFromServersObject(
  mcpServers: Record<string, unknown>,
  into: McpServerEntry[]
): void {
  for (const [name, val] of Object.entries(mcpServers)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const mcp = serverEntryToMcp(name, val as Record<string, unknown>);
      if (mcp) into.push(mcp);
    }
  }
}

export async function parseMcpJson(filePath: string): Promise<McpServerEntry[]> {
  try {
    const content = await readFileSafe(filePath);
    if (!content) return [];
    const data = JSON.parse(content) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return [];

    const results: McpServerEntry[] = [];

    if (data.mcpServers && typeof data.mcpServers === 'object') {
      collectFromServersObject(
        data.mcpServers as Record<string, unknown>,
        results
      );
      return results;
    }

    if (data.projects && typeof data.projects === 'object') {
      const seen = new Set<string>();
      const projects = data.projects as Record<string, unknown>;
      for (const proj of Object.values(projects)) {
        if (proj && typeof proj === 'object') {
          const servers = (proj as Record<string, unknown>)
            .mcpServers as Record<string, unknown> | undefined;
          if (servers && typeof servers === 'object') {
            for (const [name, val] of Object.entries(servers)) {
              if (seen.has(name)) continue;
              seen.add(name);
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                const mcp = serverEntryToMcp(name, val as Record<string, unknown>);
                if (mcp) results.push(mcp);
              }
            }
          }
        }
      }
      return results;
    }

    for (const [name, val] of Object.entries(data)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const mcp = serverEntryToMcp(name, val as Record<string, unknown>);
        if (mcp) results.push(mcp);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function parseMcpToml(filePath: string): Promise<McpServerEntry[]> {
  try {
    const content = await readFileSafe(filePath);
    if (!content) return [];
    const data = parseToml(content) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return [];

    const mcpServers = data.mcp_servers as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!mcpServers || typeof mcpServers !== 'object') return [];

    const results: McpServerEntry[] = [];
    for (const [name, val] of Object.entries(mcpServers)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const mcp = serverEntryToMcp(name, val as Record<string, unknown>);
        if (mcp) results.push(mcp);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function parseHooksFromSettings(
  filePath: string
): Promise<ConfigEntry[]> {
  const content = await readFileSafe(filePath);
  if (!content) return [];

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }

  const hooks = data.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];

  const entries: ConfigEntry[] = [];

  for (const [eventName, matcherGroups] of Object.entries(hooks)) {
    if (!Array.isArray(matcherGroups)) continue;

    const matcherCount = matcherGroups.length;
    const matchers: string[] = [];
    const handlers: Array<{
      type: string;
      command?: string;
      url?: string;
      async?: boolean;
      timeout?: number;
    }> = [];

    for (const mg of matcherGroups) {
      if (!mg || typeof mg !== 'object' || Array.isArray(mg)) continue;
      const m = mg as Record<string, unknown>;
      const matcher = String(m.matcher ?? '');
      if (matcher && matcher !== '*') matchers.push(matcher);
      const hookList = m.hooks;
      if (!Array.isArray(hookList)) continue;
      for (const h of hookList) {
        if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
        const handler = h as Record<string, unknown>;
        const type = String(handler.type ?? '');
        handlers.push({
          type,
          command: typeof handler.command === 'string' ? handler.command : undefined,
          url: typeof handler.url === 'string' ? handler.url : undefined,
          async: typeof handler.async === 'boolean' ? handler.async : undefined,
          timeout: typeof handler.timeout === 'number' ? handler.timeout : undefined,
        });
      }
    }

    const hookCount = handlers.length;
    const hookLabel = hookCount === 1 ? '1 hook' : `${hookCount} hooks`;

    let description: string;
    if (matcherCount === 1 && hookCount === 1) {
      const h = handlers[0];
      if (h.type === 'command' && h.command) {
        description = `command: ${path.basename(h.command)}`;
      } else if (h.type === 'http' && h.url) {
        description = `http: ${h.url}`;
      } else {
        description = h.type || 'hook';
      }
    } else if (matcherCount === 1) {
      description =
        matchers.length === 1
          ? `1 matcher (${matchers[0]}), ${hookLabel}`
          : `1 matcher, ${hookLabel}`;
    } else {
      description = `${matcherCount} matchers, ${hookLabel}`;
    }

    entries.push({
      name: eventName,
      path: filePath,
      exists: true,
      description,
      frontmatter: {
        matcherCount,
        hookCount,
        matchers,
        handlers,
      },
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export async function parseCursorUserRules(dbPath: string): Promise<ConfigEntry[]> {
  try {
    await fs.stat(dbPath);
  } catch {
    return [];
  }

  try {
    const { stdout } = await execFileAsync('sqlite3', [
      dbPath,
      "SELECT value FROM ItemTable WHERE key = 'aicontext.personalContext';",
    ], { timeout: 5000 });

    const value = stdout.trim();
    if (!value) return [];

    const lines = value.split(/\n/).length;
    const preview = value.length > 120 ? value.slice(0, 120) + '...' : value;

    return [{
      name: 'User Rules',
      path: dbPath,
      exists: true,
      description: `${value.length} chars, ${lines} lines: ${preview}`,
    }];
  } catch {
    return [];
  }
}
