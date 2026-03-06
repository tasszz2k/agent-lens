import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CostReport } from '../types.js';

interface CostViewProps {
  report: CostReport | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCommandBarOpen: () => void;
  onToggleHelp: () => void;
  height: number;
  width: number;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(1) + 'K';
  return (n / 1e6).toFixed(1) + 'M';
}

function formatCost(n: number): string {
  return '$' + n.toFixed(2);
}

interface LineItem {
  element: React.ReactElement;
}

function buildLines(report: CostReport, width: number): LineItem[] {
  const lines: LineItem[] = [];
  const pad = (s: string, len: number) => s.padEnd(len);
  const padLeft = (s: string, len: number) => s.padStart(len);

  lines.push({ element: <Text key="header" bold>COST -- {report.month}</Text> });
  lines.push({ element: <Text key="hint" dimColor>(pressed r to refresh)</Text> });
  lines.push({ element: <Text key="sp1">{' '}</Text> });

  let totalUsd = 0;

  for (const tool of report.tools) {
    if (tool.error) {
      const dash = padLeft('--', width - tool.tool.length);
      lines.push({
        element: (
          <Text key={`tool-${tool.tool}-err`}>
            <Text bold color="white">{tool.tool}</Text>
            <Text color="red">{dash}</Text>
          </Text>
        ),
      });
      lines.push({
        element: (
          <Text key={`tool-${tool.tool}-err-msg`} color="red">
            {'  Error: '}{tool.error}
          </Text>
        ),
      });
      continue;
    }

    totalUsd += tool.totalCostUsd;
    const hasCost = tool.totalCostUsd > 0 || tool.models.some(m => m.costUsd > 0);
    const hasRequests = tool.totalRequests != null && tool.totalRequests > 0;
    const hasLimit = tool.maxRequests != null && tool.maxRequests > 0;

    let costStr: string;
    let costColor: string;
    if (hasCost) {
      costStr = formatCost(tool.totalCostUsd);
      costColor = 'green';
    } else if (hasRequests && hasLimit) {
      costStr = `${tool.totalRequests} / ${tool.maxRequests} reqs`;
      costColor = 'cyan';
    } else if (hasRequests) {
      costStr = `${tool.totalRequests} reqs`;
      costColor = 'cyan';
    } else {
      costStr = '--';
      costColor = 'gray';
    }

    const planLabel = tool.planType ? ` (${tool.planType})` : '';
    lines.push({
      element: (
        <Text key={`tool-${tool.tool}`}>
          <Text bold color="white">{tool.tool}</Text>
          <Text dimColor>{planLabel}</Text>
          <Text color={costColor}>{padLeft(costStr, width - tool.tool.length - planLabel.length)}</Text>
        </Text>
      ),
    });
    lines.push({
      element: (
        <Text key={`period-${tool.tool}`} dimColor>
          {'  Period: '}{tool.period}
        </Text>
      ),
    });

    if (hasRequests && hasLimit) {
      const pct = ((tool.totalRequests! / tool.maxRequests!) * 100).toFixed(1);
      const barWidth = 20;
      const filled = Math.round((tool.totalRequests! / tool.maxRequests!) * barWidth);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
      lines.push({
        element: (
          <Text key={`bar-${tool.tool}`}>
            {'  '}
            <Text color="cyan">{bar.slice(0, filled)}</Text>
            <Text dimColor>{bar.slice(filled)}</Text>
            {' '}{tool.totalRequests} / {tool.maxRequests} premium requests ({pct}%)
          </Text>
        ),
      });
    }

    lines.push({ element: <Text key={`sp-${tool.tool}`}>{' '}</Text> });

    const colModel = 20;
    const colNum = 10;

    if (hasRequests && !hasCost) {
      const header = '  ' +
        pad('Model', colModel) +
        pad('Tokens', colNum) +
        pad('Requests', colNum);
      lines.push({
        element: (
          <Text key={`model-header-${tool.tool}`} dimColor>
            {header}
          </Text>
        ),
      });
      for (const m of tool.models) {
        const modelCell = pad(m.model.slice(0, colModel - 1), colModel);
        const tokCell = pad(formatTokens(m.inputTokens), colNum);
        const reqCell = pad(String(m.numRequests ?? 0), colNum);
        lines.push({
          element: (
            <Text key={`model-${tool.tool}-${m.model}`}>
              {'  '}
              <Text color="yellow">{modelCell}</Text>
              {tokCell}
              {reqCell}
            </Text>
          ),
        });
      }
      lines.push({
        element: (
          <Text key={`total-tokens-${tool.tool}`} dimColor>
            {'  Total: '}{formatTokens(tool.totalInputTokens)}{' tokens / '}{tool.totalRequests}{' requests'}
          </Text>
        ),
      });
    } else {
      const header = '  ' +
        pad('Model', colModel) +
        pad('Input', colNum) +
        pad('Output', colNum) +
        pad('Cache W', colNum) +
        pad('Cache R', colNum) +
        pad('Cost', colNum);
      lines.push({
        element: (
          <Text key={`model-header-${tool.tool}`} dimColor>
            {header}
          </Text>
        ),
      });
      for (const m of tool.models) {
        const modelCell = pad(m.model.slice(0, colModel - 1), colModel);
        const inCell = pad(formatTokens(m.inputTokens), colNum);
        const outCell = pad(formatTokens(m.outputTokens), colNum);
        const cwCell = pad(formatTokens(m.cacheWriteTokens), colNum);
        const crCell = pad(formatTokens(m.cacheReadTokens), colNum);
        lines.push({
          element: (
            <Text key={`model-${tool.tool}-${m.model}`}>
              {'  '}
              <Text color="yellow">{modelCell}</Text>
              {inCell}
              {outCell}
              {cwCell}
              {crCell}
              <Text color="green">{formatCost(m.costUsd)}</Text>
            </Text>
          ),
        });
      }
      const totalIn = formatTokens(tool.totalInputTokens);
      const totalOut = formatTokens(tool.totalOutputTokens);
      lines.push({
        element: (
          <Text key={`total-tokens-${tool.tool}`} dimColor>
            {'  Total Tokens: '}{totalIn}{' in / '}{totalOut}{' out'}
          </Text>
        ),
      });
    }
    lines.push({ element: <Text key={`sp2-${tool.tool}`}>{' '}</Text> });
  }

  lines.push({
    element: (
      <Text key="divider" dimColor>
        {'─'.repeat(Math.min(60, width))}
      </Text>
    ),
  });
  lines.push({
    element: (
      <Text key="total" bold>
        <Text bold>TOTAL</Text>
        <Text bold color="green">{padLeft(formatCost(totalUsd), width - 5)}</Text>
      </Text>
    ),
  });

  return lines;
}

export default function CostView({
  report,
  loading,
  onClose,
  onRefresh,
  onCommandBarOpen,
  onToggleHelp,
  height,
  width,
}: CostViewProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pendingG, setPendingG] = useState(false);

  const lines = useMemo(() => {
    if (!report) return [];
    return buildLines(report, width);
  }, [report, width]);

  const borderRows = 4;
  const footerRows = 2;
  const scrollableHeight = Math.max(1, height - borderRows - footerRows);
  const maxScroll = Math.max(0, lines.length - scrollableHeight);

  const visibleLines = lines.slice(scrollOffset, scrollOffset + scrollableHeight);

  useInput(
    (input, key) => {
      if (pendingG) {
        setPendingG(false);
        if (input === 'g') setScrollOffset(0);
        return;
      }
      if (key.escape || input === 'q') {
        onClose();
        return;
      }
      if (input === '?') {
        onToggleHelp();
        return;
      }
      if (input === ':') {
        onCommandBarOpen();
        return;
      }
      if (input === 'r') {
        onRefresh();
        return;
      }
      if (key.upArrow || input === 'k') {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setScrollOffset((prev) => Math.min(maxScroll, prev + 1));
        return;
      }
      if (input === 'G') {
        setScrollOffset(maxScroll);
        return;
      }
      if (input === 'g') {
        setPendingG(true);
        return;
      }
      if (key.ctrl && input === 'd') {
        setScrollOffset((prev) => Math.min(maxScroll, prev + Math.floor(scrollableHeight / 2)));
        return;
      }
      if (key.ctrl && input === 'u') {
        setScrollOffset((prev) => Math.max(0, prev - Math.floor(scrollableHeight / 2)));
        return;
      }
    },
    { isActive: true }
  );

  if (loading) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        paddingY={1}
        height={height}
        width={width}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>Loading cost data...</Text>
      </Box>
    );
  }

  if (!report) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        paddingY={1}
        height={height}
        width={width}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>No cost data available. Press r to refresh.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      paddingY={1}
      height={height}
      width={width}
      overflow="hidden"
    >
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.map(({ element }, i) => (
          <Box key={element.key ?? i}>{element}</Box>
        ))}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>j/k: scroll  G/gg: bottom/top  r: refresh  : command  ? help  q/esc: back</Text>
        {lines.length > scrollableHeight && (
          <Text dimColor>
            [{scrollOffset + 1}-{Math.min(scrollOffset + scrollableHeight, lines.length)}/{lines.length}]
          </Text>
        )}
      </Box>
    </Box>
  );
}
