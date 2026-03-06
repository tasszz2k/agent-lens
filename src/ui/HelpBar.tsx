import React from 'react';
import { Box, Text } from 'ink';

interface KeyDef {
  key: string;
  label: string;
}

const treeKeys: KeyDef[] = [
  { key: 'j/k', label: 'Navigate' },
  { key: 'h', label: 'Collapse' },
  { key: 'l', label: 'Expand' },
  { key: 'enter', label: 'Open' },
  { key: '/', label: 'Search' },
  { key: 'c', label: 'Current' },
  { key: 'gg', label: 'Top' },
  { key: 'G', label: 'Bottom' },
  { key: 'ctrl-d', label: 'Page Down' },
  { key: 'ctrl-u', label: 'Page Up' },
  { key: 's', label: 'Settings' },
  { key: 'q', label: 'Quit' },
];

const detailKeys: KeyDef[] = [
  { key: 'j/k', label: 'Navigate' },
  { key: 'enter', label: 'Open Linked' },
  { key: 'gg', label: 'Top' },
  { key: 'G', label: 'Bottom' },
  { key: 'ctrl-d', label: 'Page Down' },
  { key: 'ctrl-u', label: 'Page Up' },
  { key: 'q/esc', label: 'Close' },
];

const settingsKeys: KeyDef[] = [
  { key: 'j/k', label: 'Navigate' },
  { key: 'space/enter', label: 'Toggle' },
  { key: 'q/esc', label: 'Back' },
];

interface HelpBarProps {
  view: 'tree' | 'detail' | 'settings';
  width: number;
}

export default function HelpBar({ view, width }: HelpBarProps) {
  const keys = view === 'tree' ? treeKeys : view === 'detail' ? detailKeys : settingsKeys;
  const pairs: React.ReactElement[] = [];
  for (let i = 0; i < keys.length; i++) {
    const { key, label } = keys[i];
    pairs.push(
      <Box key={i} marginRight={2}>
        <Text color="cyan">&lt;{key}&gt;</Text>
        <Text> {label}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" width={width}>
      {pairs}
    </Box>
  );
}
