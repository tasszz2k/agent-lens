import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AgentLensConfig } from './types.js';

const CONFIG_DIR = '.config/agentlens';
const CONFIG_FILE = 'config.json';

const AGENT_MARKERS = [
  '.claude',
  '.cursor',
  'CLAUDE.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
];

function toPortable(p: string): string {
  const home = os.homedir();
  const normalized = path.normalize(p);
  if (normalized === home || normalized.startsWith(home + path.sep)) {
    const relative = path.relative(home, normalized);
    return relative ? `~/${relative}` : '~';
  }
  return normalized;
}

function fromPortable(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1) || '');
  }
  return path.normalize(p);
}

export function getConfigPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
}

export async function loadConfig(): Promise<AgentLensConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { roots?: string[] };
    const roots = Array.isArray(parsed?.roots)
      ? parsed.roots.map(fromPortable)
      : [];
    return { roots };
  } catch {
    return { roots: [] };
  }
}

export async function saveConfig(config: AgentLensConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  const portable = {
    roots: config.roots.map(toPortable),
  };
  await fs.writeFile(configPath, JSON.stringify(portable, null, 2) + '\n');
}

export async function addRoot(rootPath: string): Promise<AgentLensConfig> {
  const config = await loadConfig();
  const normalized = path.resolve(rootPath);
  const roots = [...config.roots];
  if (!roots.includes(normalized)) {
    roots.push(normalized);
  }
  const next = { roots };
  await saveConfig(next);
  return next;
}

export async function removeRoot(rootPath: string): Promise<AgentLensConfig> {
  const config = await loadConfig();
  const normalized = path.resolve(rootPath);
  const roots = config.roots.filter((r) => path.normalize(r) !== normalized);
  const next = { roots };
  await saveConfig(next);
  return next;
}

async function hasAnyMarker(dir: string): Promise<boolean> {
  for (const marker of AGENT_MARKERS) {
    const p = path.join(dir, marker);
    try {
      await fs.access(p);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function discoverProjects(roots: string[], maxDepth = 3): Promise<string[]> {
  const projects: string[] = [];
  const seen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
      const childPath = path.join(dir, entry.name);
      const normalized = path.normalize(childPath);
      if (seen.has(normalized)) continue;
      if (await hasAnyMarker(childPath)) {
        seen.add(normalized);
        projects.push(childPath);
      } else if (depth < maxDepth) {
        await walk(childPath, depth + 1);
      }
    }
  }

  for (const root of roots) {
    await walk(path.resolve(root), 1);
  }

  return projects;
}
