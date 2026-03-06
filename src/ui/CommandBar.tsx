import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const PAGES = [
  { id: 'scan', label: 'Scan', desc: 'Agent configuration map' },
  { id: 'cost', label: 'Cost', desc: 'Usage & cost dashboard' },
] as const;

interface CommandBarProps {
  active: boolean;
  onNavigate: (page: string) => void;
  onClose: () => void;
}

export default function CommandBar({
  active,
  onNavigate,
  onClose,
}: CommandBarProps) {
  const [input, setInput] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    if (active) {
      setInput('');
      setSelectedIdx(-1);
    }
  }, [active]);

  const filtered = input.length > 0
    ? PAGES.filter(
        (p) =>
          p.id.startsWith(input.toLowerCase()) ||
          p.label.toLowerCase().startsWith(input.toLowerCase())
      )
    : [...PAGES];

  useInput(
    (keyInput, key) => {
      if (!active) return;
      if (key.escape) {
        onClose();
        return;
      }
      if (key.downArrow || (key.ctrl && keyInput === 'n')) {
        setSelectedIdx((prev) => Math.min(filtered.length - 1, prev + 1));
        return;
      }
      if (key.upArrow || (key.ctrl && keyInput === 'p')) {
        setSelectedIdx((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.return) {
        const target = selectedIdx >= 0 && selectedIdx < filtered.length
          ? filtered[selectedIdx]
          : filtered[0];
        if (target) {
          onNavigate(target.id);
          setInput('');
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (input.length === 0) {
          onClose();
        } else {
          setInput(input.slice(0, -1));
          setSelectedIdx(-1);
        }
        return;
      }
      if (keyInput.length > 0 && !key.ctrl && !key.meta) {
        setInput((prev) => prev + keyInput);
        setSelectedIdx(-1);
      }
    },
    { isActive: active }
  );

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setShowCursor((s) => !s), 500);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const suggestion = selectedIdx >= 0 && selectedIdx < filtered.length
    ? filtered[selectedIdx].label.slice(input.length)
    : filtered.length > 0
      ? filtered[0].label.slice(input.length)
      : '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text>: </Text>
        <Text>{input}</Text>
        <Text dimColor>{suggestion}</Text>
        <Text>{showCursor ? '_' : ' '}</Text>
        <Text dimColor>  (type or use up/down to select)</Text>
      </Box>
      {filtered.length > 0 && (
        <Box flexDirection="column">
          {filtered.map((p, i) => (
            <Box key={p.id}>
              <Text>  </Text>
              <Text color={i === selectedIdx ? 'cyan' : undefined} bold={i === selectedIdx}>
                {i === selectedIdx ? '> ' : '  '}{p.label}
              </Text>
              <Text dimColor>  {p.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
