import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import os from 'node:os';
import path from 'node:path';
import type { ScanResult } from '../types.js';
import { LABEL_CATEGORIES, getConfigPath } from '../config.js';

function tildify(p: string): string {
  const home = os.homedir();
  if (p === home || p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

type ListItem =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'info'; id: string; render: () => React.ReactElement }
  | { kind: 'toggle'; type: 'tool' | 'category'; id: string; label: string };

interface SettingsViewProps {
  scanResult: ScanResult;
  disabledTools: Set<string>;
  disabledCategories: Set<string>;
  onToggleTool: (tool: string) => void;
  onToggleCategory: (category: string) => void;
  onClose: () => void;
  height: number;
  width: number;
  configRoots: string[];
  hasCursorToken: boolean;
}

export default function SettingsView({
  scanResult,
  disabledTools,
  disabledCategories,
  onToggleTool,
  onToggleCategory,
  onClose,
  height,
  width,
  configRoots,
  hasCursorToken,
}: SettingsViewProps) {
  const [cursor, setCursor] = useState(0);

  const items = useMemo(() => {
    const result: ListItem[] = [];

    const dim = '\u2502';
    const branch = '\u251C\u2500\u2500';
    const last = '\u2514\u2500\u2500';
    const col = 22;

    result.push({ kind: 'header', id: 'config-header', label: 'Configuration' });
    result.push({
      kind: 'info', id: 'config-path',
      render: () => (
        <Text>
          {'    '}
          <Text dimColor>{'Config'.padEnd(col)}</Text>
          <Text>{tildify(getConfigPath())}</Text>
        </Text>
      ),
    });

    const projectCount = scanResult.projects?.length ?? 0;
    result.push({
      kind: 'info', id: 'projects-count',
      render: () => (
        <Text>
          {'    '}
          <Text dimColor>{'Discovered Projects'.padEnd(col)}</Text>
          <Text>{projectCount > 0 ? String(projectCount) : '--'}</Text>
        </Text>
      ),
    });

    result.push({
      kind: 'info', id: 'cursor-token',
      render: () => (
        <Text>
          {'    '}
          <Text dimColor>{'Cursor Token'.padEnd(col)}</Text>
          {hasCursorToken
            ? <Text color="green">configured</Text>
            : <Text dimColor>not set</Text>}
        </Text>
      ),
    });
    if (!hasCursorToken) {
      result.push({
        kind: 'info', id: 'cursor-hint',
        render: () => (
          <Text dimColor>{'    '.padEnd(col + 4)}agentlens config --set-cursor-token {'<token>'}</Text>
        ),
      });
    }

    result.push({
      kind: 'info', id: 'roots-header',
      render: () => (
        <Text>
          {'    '}
          <Text dimColor>{'Workspace Roots'.padEnd(col)}</Text>
          {configRoots.length > 0
            ? <Text>{configRoots.length}</Text>
            : <Text dimColor>none</Text>}
        </Text>
      ),
    });
    if (configRoots.length > 0) {
      for (let i = 0; i < configRoots.length; i++) {
        const isLast = i === configRoots.length - 1;
        const prefix = isLast ? last : branch;
        const idx = i;
        result.push({
          kind: 'info', id: `root-${i}`,
          render: () => (
            <Text>
              {'    '}
              <Text dimColor>{' '.repeat(col)}{prefix} </Text>
              <Text color="white">{tildify(configRoots[idx])}</Text>
            </Text>
          ),
        });
      }
    } else {
      result.push({
        kind: 'info', id: 'roots-hint',
        render: () => (
          <Text dimColor>{'    '.padEnd(col + 4)}agentlens config --add-root {'<path>'}</Text>
        ),
      });
    }

    result.push({
      kind: 'info', id: 'config-spacer',
      render: () => <Text>{' '}</Text>,
    });

    const toolNames = new Set<string>();
    for (const tc of [...scanResult.global, ...scanResult.project]) {
      toolNames.add(tc.tool);
    }
    result.push({ kind: 'header', id: 'tools-header', label: 'Tools' });
    for (const name of [...toolNames].sort()) {
      result.push({ kind: 'toggle', type: 'tool', id: name, label: name });
    }

    const presentLabels = new Set<string>();
    for (const tc of [...scanResult.global, ...scanResult.project]) {
      if (!tc.label) continue;
      for (const cat of LABEL_CATEGORIES) {
        if (tc.label.startsWith(cat.match)) {
          presentLabels.add(cat.id);
        }
      }
    }

    if (presentLabels.size > 0) {
      result.push({ kind: 'header', id: 'categories-header', label: 'Categories' });
      for (const cat of LABEL_CATEGORIES) {
        if (presentLabels.has(cat.id)) {
          result.push({ kind: 'toggle', type: 'category', id: cat.id, label: cat.label });
        }
      }
    }

    return result;
  }, [scanResult, configRoots, hasCursorToken]);

  const selectableIndices = useMemo(() => {
    const out: number[] = [];
    items.forEach((item, i) => {
      if (item.kind === 'toggle') out.push(i);
    });
    return out;
  }, [items]);

  const selectablePos = selectableIndices.indexOf(
    selectableIndices.find((si) => si >= cursor) ?? selectableIndices[0]
  );

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow || input === 'k') {
      const prev = selectablePos - 1;
      if (prev >= 0) setCursor(selectableIndices[prev]);
      return;
    }
    if (key.downArrow || input === 'j') {
      const next = selectablePos + 1;
      if (next < selectableIndices.length) setCursor(selectableIndices[next]);
      return;
    }
    if (input === ' ' || key.return) {
      const item = items[cursor];
      if (item.kind !== 'toggle') return;
      if (item.type === 'tool') onToggleTool(item.id);
      else onToggleCategory(item.id);
      return;
    }
  });

  const listHeight = Math.max(1, height - 6);
  const scrollOffset = Math.max(0, Math.min(cursor - listHeight + 1, items.length - listHeight));
  const visible = items.slice(scrollOffset, scrollOffset + listHeight);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} height={height} width={width}>
      <Text bold>SETTINGS</Text>
      <Text>{' '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((item, i) => {
          const globalIdx = scrollOffset + i;
          if (item.kind === 'header') {
            return <Text key={item.id} bold dimColor>  {item.label}</Text>;
          }
          if (item.kind === 'info') {
            return <Box key={item.id}>{item.render()}</Box>;
          }
          const isSelected = globalIdx === cursor;
          const isDisabled = item.type === 'tool'
            ? disabledTools.has(item.id)
            : disabledCategories.has(item.id);
          const checkbox = isDisabled ? '[ ]' : '[x]';
          const checkColor = isDisabled ? 'red' : 'green';
          return (
            <Box key={`${item.type}:${item.id}`}>
              <Text inverse={isSelected}>
                {'    '}
                <Text color={checkColor}>{checkbox}</Text>
                {' '}
                {item.label}
                {'  '}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>j/k: navigate  space/enter: toggle  q/esc: back</Text>
        {items.length > listHeight && (
          <Text dimColor>[{scrollOffset + 1}-{Math.min(scrollOffset + listHeight, items.length)}/{items.length}]</Text>
        )}
      </Box>
    </Box>
  );
}
