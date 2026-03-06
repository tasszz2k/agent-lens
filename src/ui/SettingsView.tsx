import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ScanResult } from '../types.js';
import { LABEL_CATEGORIES } from '../config.js';

interface SettingsItem {
  type: 'tool' | 'category';
  id: string;
  label: string;
}

interface SettingsViewProps {
  scanResult: ScanResult;
  disabledTools: Set<string>;
  disabledCategories: Set<string>;
  onToggleTool: (tool: string) => void;
  onToggleCategory: (category: string) => void;
  onClose: () => void;
  height: number;
  width: number;
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
}: SettingsViewProps) {
  const [cursor, setCursor] = useState(0);

  const items = useMemo(() => {
    const result: (SettingsItem | 'tools-header' | 'categories-header')[] = [];

    const toolNames = new Set<string>();
    for (const tc of [...scanResult.global, ...scanResult.project]) {
      toolNames.add(tc.tool);
    }
    result.push('tools-header');
    for (const name of [...toolNames].sort()) {
      result.push({ type: 'tool', id: name, label: name });
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
      result.push('categories-header');
      for (const cat of LABEL_CATEGORIES) {
        if (presentLabels.has(cat.id)) {
          result.push({ type: 'category', id: cat.id, label: cat.label });
        }
      }
    }

    return result;
  }, [scanResult]);

  const selectableIndices = useMemo(() => {
    const out: number[] = [];
    items.forEach((item, i) => {
      if (typeof item !== 'string') out.push(i);
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
      if (typeof item === 'string') return;
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
      <Text bold>SETTINGS - Filters</Text>
      <Text dimColor>Toggle which tools and categories appear in scan results</Text>
      <Text>{' '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((item, i) => {
          const globalIdx = scrollOffset + i;
          if (item === 'tools-header') {
            return <Text key="th" bold dimColor>  Tools</Text>;
          }
          if (item === 'categories-header') {
            return <Text key="ch" bold dimColor>{'\n'}  Categories</Text>;
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
