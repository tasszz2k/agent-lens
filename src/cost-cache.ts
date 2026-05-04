import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CostReport } from './types.js';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'agentlens');
const CACHE_FILE = path.join(CACHE_DIR, 'cost-report.json');

export interface CachedCostReport {
  report: CostReport;
  cachedAt: string;
  ageMs: number;
}

export async function loadCostCache(): Promise<CachedCostReport | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { report?: CostReport; cachedAt?: string };
    if (!parsed.report || !parsed.cachedAt) return null;
    const cachedAtMs = Date.parse(parsed.cachedAt);
    const ageMs = Number.isFinite(cachedAtMs) ? Date.now() - cachedAtMs : 0;
    return { report: parsed.report, cachedAt: parsed.cachedAt, ageMs };
  } catch {
    return null;
  }
}

export async function saveCostCache(report: CostReport): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const payload = JSON.stringify({ report, cachedAt: new Date().toISOString() });
    await fs.writeFile(CACHE_FILE, payload, 'utf-8');
  } catch {
    // best-effort; cache failures must not break the user-facing flow
  }
}

export function formatCacheAge(ageMs: number): string {
  if (ageMs < 0) return 'just now';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
