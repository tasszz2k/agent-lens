import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CostReport, ToolCostSummary, ModelCostBreakdown } from './types.js';
import { loadConfig } from './config.js';

const execFileAsync = promisify(execFile);

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PRICING = {
  opus: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

function normalizeModelName(raw: string): keyof typeof PRICING {
  const lower = raw.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'sonnet';
}

async function collectJsonlPaths(dir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.endsWith('.jsonl')) {
        result.push(full);
      }
    }
  }
  await walk(dir);
  return result;
}

export async function fetchClaudeCodeCosts(): Promise<ToolCostSummary> {
  const period = formatPeriod();
  try {
    const home = os.homedir();
    const dirs = [
      path.join(home, '.claude', 'projects'),
      path.join(home, '.config', 'claude', 'projects'),
    ];
    const allPaths: string[] = [];
    for (const d of dirs) {
      try {
        await fs.access(d);
        allPaths.push(...(await collectJsonlPaths(d)));
      } catch {
        // dir missing, skip
      }
    }

    const now = new Date();
    const monthStart = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));

    const byModel: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {};

    for (const fp of allPaths) {
      let content: string;
      try {
        content = await fs.readFile(fp, 'utf-8');
      } catch {
        continue;
      }
      for (const line of content.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let row: { type?: string; timestamp?: string; message?: { usage?: Record<string, number>; model?: string } };
        try {
          row = JSON.parse(trimmed) as typeof row;
        } catch {
          continue;
        }
        if (row.type !== 'assistant') continue;
        const ts = row.timestamp;
        if (typeof ts !== 'string' || ts < monthStart) continue;
        const msg = row.message;
        if (!msg || typeof msg !== 'object') continue;
        const usage = msg.usage;
        if (!usage || typeof usage !== 'object') continue;

        const inputTokens = (usage as Record<string, number>).input_tokens ?? 0;
        const outputTokens = (usage as Record<string, number>).output_tokens ?? 0;
        const cacheWrite = (usage as Record<string, number>).cache_creation_input_tokens ?? 0;
        const cacheRead = (usage as Record<string, number>).cache_read_input_tokens ?? 0;

        const rawModel = msg.model ?? '';
        const modelKey = normalizeModelName(rawModel);

        if (!byModel[modelKey]) {
          byModel[modelKey] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
        }
        byModel[modelKey].input += inputTokens;
        byModel[modelKey].output += outputTokens;
        byModel[modelKey].cacheWrite += cacheWrite;
        byModel[modelKey].cacheRead += cacheRead;
      }
    }

    const models: ModelCostBreakdown[] = [];
    let totalCostUsd = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const [modelKey, tok] of Object.entries(byModel)) {
      const p = PRICING[modelKey as keyof typeof PRICING] ?? PRICING.sonnet;
      const costUsd =
        (tok.input / 1_000_000) * p.input +
        (tok.output / 1_000_000) * p.output +
        (tok.cacheWrite / 1_000_000) * p.cacheWrite +
        (tok.cacheRead / 1_000_000) * p.cacheRead;

      totalCostUsd += costUsd;
      totalInput += tok.input;
      totalOutput += tok.output;

      models.push({
        model: `claude-${modelKey}`,
        inputTokens: tok.input,
        outputTokens: tok.output,
        cacheWriteTokens: tok.cacheWrite,
        cacheReadTokens: tok.cacheRead,
        costUsd,
      });
    }

    models.sort((a, b) => b.costUsd - a.costUsd);

    return {
      tool: 'Claude Code',
      totalCostUsd,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      models,
      period,
    };
  } catch (err) {
    return {
      tool: 'Claude Code',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatPeriod(): string {
  const now = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  return `${month} 1 - ${month} ${day}, ${year}`;
}

const CURSOR_TIER_NAMES: Record<string, string> = {
  'gpt-4': 'premium',
  'gpt-3.5-turbo': 'standard',
  'gpt-4o': 'premium',
  'gpt-4o-mini': 'standard',
  'o1-mini': 'standard',
};

function normalizeCursorTierName(key: string): string {
  return CURSOR_TIER_NAMES[key] ?? key;
}

const CURSOR_DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');

async function getCursorSessionToken(): Promise<string | null> {
  try {
    const config = await loadConfig();
    if (config.cursorSessionToken) return config.cursorSessionToken;
  } catch {
    // config read failed, continue to fallback
  }

  try {
    await fs.access(CURSOR_DB_PATH);
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      [CURSOR_DB_PATH, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"],
      { timeout: 5000 }
    );
    const token = stdout.trim();
    if (token) return token;

    const { stdout: fallback } = await execFileAsync(
      'sqlite3',
      [CURSOR_DB_PATH, "SELECT value FROM ItemTable WHERE key = 'WorkosCursorSessionToken';"],
      { timeout: 5000 }
    );
    return fallback.trim() || null;
  } catch {
    return null;
  }
}

export async function fetchCursorCosts(): Promise<ToolCostSummary> {
  const period = formatPeriod();
  try {
    const token = await getCursorSessionToken();
    if (!token) {
      return {
        tool: 'Cursor',
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period,
        error: 'No session token. Run: agentlens config --set-cursor-token <token>\n'
          + '  To get your token: cursor.com > DevTools (F12) > Application > Cookies > WorkosCursorSessionToken',
      };
    }

    const usageRes = await fetch('https://cursor.com/api/usage', {
      headers: { Cookie: `WorkosCursorSessionToken=${token}` },
    });

    if (!usageRes.ok) {
      const body = await usageRes.text().catch(() => '');
      const parsed = (() => { try { return JSON.parse(body) as { error?: string }; } catch { return null; } })();
      const detail = parsed?.error ?? `HTTP ${usageRes.status}`;
      const hint = detail.includes('origin') || detail.includes('authenticated')
        ? '\n  Try updating your token: agentlens config --set-cursor-token <token>\n'
          + '  Get it from: cursor.com > DevTools (F12) > Application > Cookies > WorkosCursorSessionToken'
        : '';
      return {
        tool: 'Cursor',
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period,
        error: `API error: ${detail}${hint}`,
      };
    }

    const usageData = (await usageRes.json()) as Record<string, unknown>;

    const models: ModelCostBreakdown[] = [];
    let totalTokens = 0;
    let totalRequests = 0;
    let maxRequests: number | undefined;

    for (const [key, val] of Object.entries(usageData)) {
      if (key === 'startOfMonth' || typeof val !== 'object' || !val) continue;
      const entry = val as Record<string, unknown>;
      const numTokens = typeof entry.numTokens === 'number' ? entry.numTokens : 0;
      const reqs = typeof entry.numRequests === 'number' ? entry.numRequests : 0;
      const maxReq = typeof entry.maxRequestUsage === 'number' ? entry.maxRequestUsage : undefined;

      totalTokens += numTokens;
      totalRequests += reqs;
      if (maxReq != null) maxRequests = (maxRequests ?? 0) + maxReq;

      models.push({
        model: normalizeCursorTierName(key),
        inputTokens: numTokens,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
        numRequests: reqs,
      });
    }

    models.sort((a, b) => b.inputTokens - a.inputTokens);

    let planType: string | undefined;
    try {
      const stripeRes = await fetch('https://cursor.com/api/auth/stripe', {
        headers: { Cookie: `WorkosCursorSessionToken=${token}` },
      });
      if (stripeRes.ok) {
        const stripe = (await stripeRes.json()) as Record<string, unknown>;
        const mt = stripe.membershipType;
        if (typeof mt === 'string' && mt !== 'free') planType = mt;
      }
    } catch {
      // non-critical
    }

    return {
      tool: 'Cursor',
      totalCostUsd: 0,
      totalInputTokens: totalTokens,
      totalOutputTokens: 0,
      totalRequests,
      maxRequests,
      planType,
      models,
      period,
    };
  } catch (err) {
    return {
      tool: 'Cursor',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAllCosts(): Promise<CostReport> {
  const now = new Date();
  const monthStart = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = monthNames[now.getMonth()];
  const monthLabel = `${month} ${now.getFullYear()}`;

  const [claudeResult, cursorResult] = await Promise.allSettled([
    fetchClaudeCodeCosts(),
    fetchCursorCosts(),
  ]);

  const tools: ToolCostSummary[] = [];
  if (claudeResult.status === 'fulfilled') {
    tools.push(claudeResult.value);
  } else {
    tools.push({
      tool: 'Claude Code',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period: formatPeriod(),
      error: claudeResult.reason?.message ?? String(claudeResult.reason),
    });
  }
  if (cursorResult.status === 'fulfilled') {
    tools.push(cursorResult.value);
  } else {
    tools.push({
      tool: 'Cursor',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period: formatPeriod(),
      error: cursorResult.reason?.message ?? String(cursorResult.reason),
    });
  }

  return {
    tools,
    month: monthLabel,
    monthStart,
    fetchedAt: now.toISOString(),
  };
}
