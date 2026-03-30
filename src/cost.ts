import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CostReport, ToolCostSummary, ModelCostBreakdown, OnDemandUsage, CursorLeaderboard, ClaudeAiUsage } from './types.js';
import { loadConfig, setClaudeOrgId } from './config.js';

interface ClaudeAdminUsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface ClaudeAdminCostRow {
  model: string;
  costUsd: number;
}

const execFileAsync = promisify(execFile);

function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${err.message}: ${cause.message}`;
  return err.message;
}

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
    let totalCacheW = 0;
    let totalCacheR = 0;

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
      totalCacheW += tok.cacheWrite;
      totalCacheR += tok.cacheRead;

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
      totalCacheWriteTokens: totalCacheW,
      totalCacheReadTokens: totalCacheR,
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
      error: extractErrorMessage(err),
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

async function fetchCursorUsageSummary(token: string): Promise<{
  planType: string | undefined;
  onDemand: OnDemandUsage | undefined;
  teamOnDemand: OnDemandUsage | undefined;
} | null> {
  try {
    const res = await fetch('https://cursor.com/api/usage-summary', {
      headers: { Cookie: `WorkosCursorSessionToken=${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    let planType: string | undefined;
    const mt = data.membershipType;
    if (typeof mt === 'string' && mt !== 'free') planType = mt;

    let onDemand: OnDemandUsage | undefined;
    const ind = data.individualUsage as Record<string, unknown> | undefined;
    const indOd = ind?.onDemand as Record<string, unknown> | undefined;
    if (indOd && typeof indOd.enabled === 'boolean') {
      onDemand = {
        enabled: indOd.enabled,
        usedCents: typeof indOd.used === 'number' ? indOd.used : 0,
        limitCents: typeof indOd.limit === 'number' ? indOd.limit : 0,
      };
    }

    let teamOnDemand: OnDemandUsage | undefined;
    const team = data.teamUsage as Record<string, unknown> | undefined;
    const teamOd = team?.onDemand as Record<string, unknown> | undefined;
    if (teamOd && typeof teamOd.enabled === 'boolean') {
      teamOnDemand = {
        enabled: teamOd.enabled,
        usedCents: typeof teamOd.used === 'number' ? teamOd.used : 0,
        limitCents: typeof teamOd.limit === 'number' ? teamOd.limit : 0,
      };
    }

    return { planType, onDemand, teamOnDemand };
  } catch {
    return null;
  }
}

async function fetchCursorLeaderboard(
  token: string,
  teamId: number,
  email: string
): Promise<CursorLeaderboard | null> {
  try {
    const now = new Date();
    const startDate = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    const endDate = localDateStr(now);

    const params = new URLSearchParams({
      startDate,
      endDate,
      pageSize: '10',
      teamId: String(teamId),
      user: email,
      leaderboardSortBy: 'composer_lines',
    });
    const url = `https://cursor.com/api/v2/analytics/team/leaderboard?${params.toString()}`;
    const cookie = buildCursorCookie(token, { team_id: teamId });

    const res = await fetch(url, {
      headers: { Cookie: cookie, Origin: 'https://cursor.com' },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const composerLeaderboard = data.composer_leaderboard as Record<string, unknown> | undefined;
    if (!composerLeaderboard) return null;

    const entries = composerLeaderboard.data as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(entries)) return null;

    const userEntry = entries.find((e) => e.email === email);
    if (!userEntry) return null;

    const totalUsers = typeof composerLeaderboard.total_users === 'number'
      ? composerLeaderboard.total_users
      : 0;

    return {
      rank: typeof userEntry.rank === 'number' ? userEntry.rank : 0,
      totalUsers,
      totalDiffAccepts: typeof userEntry.total_diff_accepts === 'number' ? userEntry.total_diff_accepts : 0,
      composerLinesAccepted: typeof userEntry.total_composer_lines_accepted === 'number'
        ? userEntry.total_composer_lines_accepted
        : 0,
      composerLinesSuggested: typeof userEntry.total_composer_lines_suggested === 'number'
        ? userEntry.total_composer_lines_suggested
        : 0,
      acceptanceRatio: typeof userEntry.composer_line_acceptance_ratio === 'number'
        ? userEntry.composer_line_acceptance_ratio
        : 0,
      favoriteModel: typeof userEntry.favorite_model === 'string' ? userEntry.favorite_model : '',
    };
  } catch {
    return null;
  }
}

const CURSOR_DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');

async function readVscdbKey(key: string): Promise<string | null> {
  try {
    await fs.access(CURSOR_DB_PATH);
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      [CURSOR_DB_PATH, `SELECT value FROM ItemTable WHERE key = '${key}';`],
      { timeout: 5000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function decodeToken(token: string): string {
  return token.includes('%3A%3A') ? decodeURIComponent(token) : token;
}

function extractWorkosId(token: string): string | undefined {
  const t = decodeToken(token);
  if (t.includes('::')) {
    const id = t.split('::')[0]?.trim();
    return id || undefined;
  }
  try {
    const parts = t.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof payload.sub === 'string' && payload.sub.includes('|')) {
      return payload.sub.split('|')[1] || undefined;
    }
  } catch {
    // unable to decode JWT
  }
  return undefined;
}

function buildCursorCookie(token: string, extras?: Record<string, string | number>): string {
  const t = decodeToken(token);
  const workosId = extractWorkosId(t);
  const fullToken = t.includes('::') ? t : workosId ? `${workosId}::${t}` : t;
  const parts = [`WorkosCursorSessionToken=${fullToken}`];
  if (workosId) parts.push(`workos_id=${workosId}`);
  if (extras) {
    for (const [k, v] of Object.entries(extras)) parts.push(`${k}=${v}`);
  }
  return parts.join('; ');
}

async function getCursorSessionToken(): Promise<string | null> {
  try {
    const config = await loadConfig();
    if (config.cursorSessionToken) return config.cursorSessionToken;
  } catch {
    // config read failed, continue to fallback
  }

  return (
    (await readVscdbKey('cursorAuth/accessToken')) ??
    (await readVscdbKey('WorkosCursorSessionToken')) ??
    null
  );
}

async function getCursorEmail(): Promise<string | null> {
  try {
    const config = await loadConfig();
    if (config.cursorEmail) return config.cursorEmail;
  } catch {
    // ignore
  }
  return readVscdbKey('cursorAuth/cachedEmail');
}

async function fetchCursorMe(token: string): Promise<{ userId: number; email: string } | null> {
  try {
    const res = await fetch('https://cursor.com/api/auth/me', {
      headers: { Cookie: `WorkosCursorSessionToken=${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.id !== 'number') return null;
    return {
      userId: data.id,
      email: typeof data.email === 'string' ? data.email : '',
    };
  } catch {
    return null;
  }
}

interface CursorTeamInfo {
  teamId: number;
  billingCycleStartMs: number;
  billingCycleEndMs: number;
}

async function fetchCursorTeamInfo(token: string): Promise<CursorTeamInfo | null> {
  try {
    const res = await fetch('https://cursor.com/api/dashboard/teams', {
      method: 'POST',
      headers: {
        Cookie: buildCursorCookie(token),
        'Content-Type': 'application/json',
        Origin: 'https://cursor.com',
      },
      body: '{}',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { teams?: Array<Record<string, unknown>> };
    const first = data.teams?.[0];
    if (!first || typeof first.id !== 'number') return null;
    const startMs = typeof first.billingCycleStart === 'string' ? Number(first.billingCycleStart) : NaN;
    const endMs = typeof first.billingCycleEnd === 'string' ? Number(first.billingCycleEnd) : NaN;
    return {
      teamId: first.id,
      billingCycleStartMs: Number.isFinite(startMs) ? startMs : 0,
      billingCycleEndMs: Number.isFinite(endMs) ? endMs : 0,
    };
  } catch {
    return null;
  }
}

async function fetchCursorDailySpend(
  token: string,
  teamId: number,
  userId: number,
  periodStartMs: number,
  periodEndMs: number,
): Promise<ModelCostBreakdown[] | null> {
  try {
    const res = await fetch('https://cursor.com/api/dashboard/get-daily-spend-by-category', {
      method: 'POST',
      headers: {
        Cookie: buildCursorCookie(token, { team_id: teamId }),
        'Content-Type': 'application/json',
        Origin: 'https://cursor.com',
      },
      body: JSON.stringify({ teamId, userId, periodStartMs, periodEndMs, groupBy: 1, spendType: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { dailySpend?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.dailySpend)) return null;

    const byCategory: Record<string, { tokens: number; spendCents: number }> = {};
    for (const entry of data.dailySpend) {
      const cat = typeof entry.category === 'string' ? entry.category : '';
      if (!cat) continue;
      const tokens = typeof entry.totalTokens === 'string' ? Number(entry.totalTokens) : 0;
      const spend = typeof entry.spendCents === 'number' ? entry.spendCents : 0;
      if (!byCategory[cat]) byCategory[cat] = { tokens: 0, spendCents: 0 };
      byCategory[cat].tokens += tokens;
      byCategory[cat].spendCents += spend;
    }

    const models: ModelCostBreakdown[] = Object.entries(byCategory).map(([cat, agg]) => ({
      model: cat,
      inputTokens: agg.tokens,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: agg.spendCents / 100,
    }));
    models.sort((a, b) => b.inputTokens - a.inputTokens);
    return models;
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

    const [usageRes, meResult, configResult, usageSummaryResult] = await Promise.all([
      fetch('https://cursor.com/api/usage', {
        headers: { Cookie: `WorkosCursorSessionToken=${token}` },
      }),
      fetchCursorMe(token),
      loadConfig().catch(() => ({ cursorTeamId: undefined } as { cursorTeamId?: number })),
      fetchCursorUsageSummary(token),
    ]);

    // Premium request counts from /api/usage
    let totalRequests = 0;
    let maxRequests: number | undefined;
    if (usageRes.ok) {
      const usageData = (await usageRes.json()) as Record<string, unknown>;
      for (const [key, val] of Object.entries(usageData)) {
        if (key === 'startOfMonth' || typeof val !== 'object' || !val) continue;
        const entry = val as Record<string, unknown>;
        const reqs = typeof entry.numRequests === 'number' ? entry.numRequests : 0;
        const maxReq = typeof entry.maxRequestUsage === 'number' ? entry.maxRequestUsage : undefined;
        totalRequests += reqs;
        if (maxReq != null) maxRequests = (maxRequests ?? 0) + maxReq;
      }
    }

    let planType: string | undefined;
    let onDemand: OnDemandUsage | undefined;
    let teamOnDemand: OnDemandUsage | undefined;
    let leaderboard: CursorLeaderboard | undefined;

    if (usageSummaryResult) {
      planType = usageSummaryResult.planType;
      onDemand = usageSummaryResult.onDemand;
      teamOnDemand = usageSummaryResult.teamOnDemand;
    }

    const email = meResult?.email || await getCursorEmail();
    let teamId = configResult.cursorTeamId ?? null;
    let billingStart = 0;
    let billingEnd = 0;

    const teamInfo = await fetchCursorTeamInfo(token);
    if (teamInfo) {
      teamId = teamInfo.teamId;
      billingStart = teamInfo.billingCycleStartMs;
      billingEnd = teamInfo.billingCycleEndMs;
    }

    // Per-model token + cost data from daily-spend API
    let models: ModelCostBreakdown[] = [];
    let totalTokens = 0;
    const userId = meResult?.userId ?? null;

    if (teamId != null && userId != null && billingStart > 0 && billingEnd > 0) {
      const dailyModels = await fetchCursorDailySpend(token, teamId, userId, billingStart, billingEnd);
      if (dailyModels && dailyModels.length > 0) {
        models = dailyModels;
        totalTokens = models.reduce((sum, m) => sum + m.inputTokens, 0);
      }
    }

    let leaderboardResult: PromiseSettledResult<CursorLeaderboard | null>;
    if (teamId != null && email) {
      [leaderboardResult] = await Promise.allSettled([
        fetchCursorLeaderboard(token, teamId, email),
      ]);
    } else {
      leaderboardResult = { status: 'fulfilled', value: null };
    }
    if (leaderboardResult.status === 'fulfilled' && leaderboardResult.value) {
      leaderboard = leaderboardResult.value;
    }

    const cursorCostUsd = onDemand?.enabled ? onDemand.usedCents / 100 : 0;

    return {
      tool: 'Cursor',
      totalCostUsd: cursorCostUsd,
      totalInputTokens: totalTokens,
      totalOutputTokens: 0,
      totalRequests,
      maxRequests,
      planType,
      onDemand,
      teamOnDemand,
      leaderboard,
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
      error: extractErrorMessage(err),
    };
  }
}

async function getClaudeSessionToken(): Promise<string | null> {
  try {
    const config = await loadConfig();
    return config.claudeSessionToken ?? null;
  } catch {
    return null;
  }
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normalizeClaudePlanType(raw: string): string | undefined {
  const lower = raw.toLowerCase();
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('team')) return 'team';
  if (lower === 'max' || lower.includes('max')) return 'max';
  if (lower === 'pro' || lower.includes('professional') || lower.includes('pro_')) return 'pro';
  if (lower === 'free' || lower.includes('free')) return 'free';
  if (lower.includes('subscription') || lower.includes('stripe')) return undefined;
  if (lower.includes('individual')) return 'pro';
  return undefined;
}

async function fetchClaudeBootstrap(token: string): Promise<{
  accountUuid: string;
  orgs: Array<{ uuid: string; name: string; planType?: string }>;
} | null> {
  try {
    const res = await fetch('https://claude.ai/api/bootstrap', {
      headers: { Cookie: `sessionKey=${token}`, 'User-Agent': BROWSER_UA },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const account = data.account as Record<string, unknown> | undefined;
    if (!account || typeof account.uuid !== 'string') return null;

    const memberships = account.memberships as Array<Record<string, unknown>> | undefined;
    const orgs: Array<{ uuid: string; name: string; planType?: string }> = [];
    if (Array.isArray(memberships)) {
      for (const m of memberships) {
        const org = m.organization as Record<string, unknown> | undefined;
        if (org && typeof org.uuid === 'string') {
          let planType: string | undefined;
          for (const key of ['billing_type', 'plan_type', 'subscription_type', 'plan', 'type']) {
            const val = org[key];
            if (typeof val === 'string' && val) {
              const normalized = normalizeClaudePlanType(val);
              if (normalized) {
                planType = normalized;
                break;
              }
            }
          }
          if (!planType) {
            const settings = org.settings as Record<string, unknown> | undefined;
            if (settings) {
              for (const key of ['billing_type', 'plan_type']) {
                const val = settings[key];
                if (typeof val === 'string' && val) {
                  const normalized = normalizeClaudePlanType(val);
                  if (normalized) {
                    planType = normalized;
                    break;
                  }
                }
              }
            }
          }
          const activeFlags = org.active_flags as string[] | undefined;
          if (!planType && Array.isArray(activeFlags)) {
            for (const flag of activeFlags) {
              if (typeof flag !== 'string') continue;
              const normalized = normalizeClaudePlanType(flag);
              if (normalized) {
                planType = normalized;
                break;
              }
            }
          }
          orgs.push({
            uuid: org.uuid,
            name: typeof org.name === 'string' ? org.name : '',
            planType,
          });
        }
      }
    }
    return { accountUuid: account.uuid, orgs };
  } catch {
    return null;
  }
}

async function fetchClaudeAdminUsage(
  adminKey: string,
  startDate: string,
  endDate: string,
): Promise<ClaudeAdminUsageRow[]> {
  try {
    const params = new URLSearchParams({
      group_by: 'model',
      start_date: startDate,
      end_date: endDate,
      interval: 'month',
    });
    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/usage_report/messages?${params.toString()}`,
      {
        headers: {
          'x-api-key': adminKey,
          'anthropic-version': '2023-06-01',
        },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, unknown>;
    const rows = data.data as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows)) return [];

    const byModel: Record<string, ClaudeAdminUsageRow> = {};
    for (const row of rows) {
      const model = typeof row.model === 'string' ? row.model : 'unknown';
      if (!byModel[model]) {
        byModel[model] = { model, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      }
      const m = byModel[model];
      m.inputTokens += typeof row.input_tokens === 'number' ? row.input_tokens : 0;
      m.outputTokens += typeof row.output_tokens === 'number' ? row.output_tokens : 0;
      m.cacheCreationTokens += typeof row.cache_creation_input_tokens === 'number' ? row.cache_creation_input_tokens : 0;
      m.cacheReadTokens += typeof row.cache_read_input_tokens === 'number' ? row.cache_read_input_tokens : 0;
    }
    return Object.values(byModel);
  } catch {
    return [];
  }
}

async function fetchClaudeAdminCost(
  adminKey: string,
  startDate: string,
  endDate: string,
): Promise<ClaudeAdminCostRow[]> {
  try {
    const params = new URLSearchParams({
      group_by: 'model',
      start_date: startDate,
      end_date: endDate,
      interval: 'month',
    });
    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`,
      {
        headers: {
          'x-api-key': adminKey,
          'anthropic-version': '2023-06-01',
        },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, unknown>;
    const rows = data.data as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows)) return [];

    const byModel: Record<string, ClaudeAdminCostRow> = {};
    for (const row of rows) {
      const model = typeof row.model === 'string' ? row.model : 'unknown';
      if (!byModel[model]) {
        byModel[model] = { model, costUsd: 0 };
      }
      byModel[model].costUsd += typeof row.cost_usd === 'number' ? row.cost_usd : 0;
    }
    return Object.values(byModel);
  } catch {
    return [];
  }
}

export async function fetchClaudeAiCosts(): Promise<ToolCostSummary> {
  const period = formatPeriod();
  try {
    const token = await getClaudeSessionToken();
    if (!token) {
      return {
        tool: 'Claude.ai',
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period,
        error: 'No session token. Run: agentlens config --set-claude-session-token <token>\n'
          + '  To get your token: claude.ai > DevTools (F12) > Application > Cookies > sessionKey',
      };
    }

    const bootstrap = await fetchClaudeBootstrap(token);
    if (!bootstrap) {
      return {
        tool: 'Claude.ai',
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period,
        error: 'Failed to fetch account info. Your session token may be expired.\n'
          + '  Update it: agentlens config --set-claude-session-token <token>',
      };
    }

    if (bootstrap.orgs.length === 0) {
      return {
        tool: 'Claude.ai',
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period,
        error: 'No organizations found for this account.',
      };
    }

    const config = await loadConfig();

    // Determine org order: config override first, then try all orgs
    const orgsToTry: Array<{ uuid: string; name: string; planType?: string }> = [];
    if (config.claudeOrgId) {
      const match = bootstrap.orgs.find((o) => o.uuid === config.claudeOrgId);
      if (match) orgsToTry.push(match);
    }
    for (const org of bootstrap.orgs) {
      if (!orgsToTry.some((o) => o.uuid === org.uuid)) orgsToTry.push(org);
    }

    for (const org of orgsToTry) {
      const url = `https://claude.ai/api/organizations/${org.uuid}/overage_spend_limit?account_uuid=${bootstrap.accountUuid}`;
      const usageRes = await fetch(url, {
        headers: { Cookie: `sessionKey=${token}`, 'User-Agent': BROWSER_UA },
      });

      if (!usageRes.ok) continue;

      const data = (await usageRes.json()) as Record<string, unknown>;
      if (data == null) continue;

      const spentCents = typeof data.used_credits === 'number' ? data.used_credits : 0;
      const limitCents = typeof data.monthly_credit_limit === 'number' ? data.monthly_credit_limit : null;

      const claudeAi: ClaudeAiUsage = {
        spentCents,
        limitCents,
        orgName: org.name,
        planType: org.planType,
      };

      const now = new Date();
      const startDate = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const endDate = localDateStr(nextMonth);

      let models: ModelCostBreakdown[] = [];
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheW = 0;
      let totalCacheR = 0;

      if (config.claudeAdminApiKey) {
        const [usageRows, costRows] = await Promise.all([
          fetchClaudeAdminUsage(config.claudeAdminApiKey, startDate, endDate),
          fetchClaudeAdminCost(config.claudeAdminApiKey, startDate, endDate),
        ]);

        if (usageRows.length > 0) {
          const costMap = new Map(costRows.map((c) => [c.model, c.costUsd]));
          for (const u of usageRows) {
            totalInput += u.inputTokens;
            totalOutput += u.outputTokens;
            totalCacheW += u.cacheCreationTokens;
            totalCacheR += u.cacheReadTokens;
            models.push({
              model: u.model,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              cacheWriteTokens: u.cacheCreationTokens,
              cacheReadTokens: u.cacheReadTokens,
              costUsd: costMap.get(u.model) ?? 0,
            });
          }
          models.sort((a, b) => b.costUsd - a.costUsd);
        }
      }

      return {
        tool: 'Claude.ai',
        totalCostUsd: spentCents / 100,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheWriteTokens: totalCacheW > 0 ? totalCacheW : undefined,
        totalCacheReadTokens: totalCacheR > 0 ? totalCacheR : undefined,
        planType: org.planType,
        models,
        claudeAi,
        period,
      };
    }

    return {
      tool: 'Claude.ai',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period,
      error: 'No accessible organization found. Try: agentlens config --set-claude-org-id <uuid>',
    };
  } catch (err) {
    return {
      tool: 'Claude.ai',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period,
      error: extractErrorMessage(err),
    };
  }
}

export async function fetchAllCosts(disabledCostTools?: Set<string>): Promise<CostReport> {
  const now = new Date();
  const monthStart = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = monthNames[now.getMonth()];
  const monthLabel = `${month} ${now.getFullYear()}`;

  const skip = disabledCostTools ?? new Set<string>();
  const fetchers: { tool: string; promise: Promise<ToolCostSummary> }[] = [];
  if (!skip.has('Claude.ai')) fetchers.push({ tool: 'Claude.ai', promise: fetchClaudeAiCosts() });
  if (!skip.has('Claude Code')) fetchers.push({ tool: 'Claude Code', promise: fetchClaudeCodeCosts() });
  if (!skip.has('Cursor')) fetchers.push({ tool: 'Cursor', promise: fetchCursorCosts() });

  const results = await Promise.allSettled(fetchers.map((f) => f.promise));
  const tools: ToolCostSummary[] = [];
  for (let i = 0; i < fetchers.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      tools.push(r.value);
    } else {
      tools.push({
        tool: fetchers[i].tool,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
        period: formatPeriod(),
        error: extractErrorMessage(r.reason),
      });
    }
  }

  return {
    tools,
    month: monthLabel,
    monthStart,
    fetchedAt: now.toISOString(),
  };
}
