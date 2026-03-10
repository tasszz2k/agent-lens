import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CostReport, ToolCostSummary, ModelCostBreakdown, OnDemandUsage, CursorLeaderboard, ClaudeAiUsage } from './types.js';
import { loadConfig, setClaudeOrgId } from './config.js';

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

async function fetchCursorTeamId(token: string): Promise<number | null> {
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
    const data = (await res.json()) as { teams?: Array<{ id?: number }> };
    const first = data.teams?.[0];
    return typeof first?.id === 'number' ? first.id : null;
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
    let onDemand: OnDemandUsage | undefined;
    let teamOnDemand: OnDemandUsage | undefined;
    let leaderboard: CursorLeaderboard | undefined;

    const [emailResult, configResult, usageSummaryResult] = await Promise.all([
      getCursorEmail(),
      loadConfig().catch(() => ({ cursorTeamId: undefined } as { cursorTeamId?: number })),
      fetchCursorUsageSummary(token),
    ]);

    const email = emailResult;
    let teamId = configResult.cursorTeamId ?? null;
    if (teamId == null && email) {
      teamId = await fetchCursorTeamId(token);
    }

    let leaderboardResult: PromiseSettledResult<CursorLeaderboard | null>;
    if (teamId != null && email) {
      [leaderboardResult] = await Promise.allSettled([
        fetchCursorLeaderboard(token, teamId, email),
      ]);
    } else {
      leaderboardResult = { status: 'fulfilled', value: null };
    }

    if (usageSummaryResult) {
      planType = usageSummaryResult.planType;
      onDemand = usageSummaryResult.onDemand;
      teamOnDemand = usageSummaryResult.teamOnDemand;
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
      error: err instanceof Error ? err.message : String(err),
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

async function fetchClaudeBootstrap(token: string): Promise<{
  accountUuid: string;
  orgs: Array<{ uuid: string; name: string }>;
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
    const orgs: Array<{ uuid: string; name: string }> = [];
    if (Array.isArray(memberships)) {
      for (const m of memberships) {
        const org = m.organization as Record<string, unknown> | undefined;
        if (org && typeof org.uuid === 'string') {
          orgs.push({
            uuid: org.uuid,
            name: typeof org.name === 'string' ? org.name : '',
          });
        }
      }
    }
    return { accountUuid: account.uuid, orgs };
  } catch {
    return null;
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
    const orgsToTry: Array<{ uuid: string; name: string }> = [];
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
      };

      return {
        tool: 'Claude.ai',
        totalCostUsd: spentCents / 100,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        models: [],
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

  const [claudeResult, cursorResult, claudeAiResult] = await Promise.allSettled([
    fetchClaudeCodeCosts(),
    fetchCursorCosts(),
    fetchClaudeAiCosts(),
  ]);

  const tools: ToolCostSummary[] = [];
  if (claudeAiResult.status === 'fulfilled') {
    tools.push(claudeAiResult.value);
  } else {
    tools.push({
      tool: 'Claude.ai',
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      period: formatPeriod(),
      error: claudeAiResult.reason?.message ?? String(claudeAiResult.reason),
    });
  }
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
