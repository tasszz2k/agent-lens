import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TreeNode, ConfigEntry } from '../types.js';
import { theme } from './theme.js';

interface DetailPanelProps {
  node: TreeNode;
  onClose: () => void;
  height: number;
}

function getPath(node: TreeNode): string | undefined {
  const d = node.data;
  if (d && 'path' in d) return (d as ConfigEntry).path;
  if (d && 'basePath' in d) return d.basePath;
  return undefined;
}

export default function DetailPanel({ node, onClose, height }: DetailPanelProps) {
  const path = getPath(node);
  const entry = node.data && 'path' in node.data ? (node.data as ConfigEntry) : null;
  const symlinkChain = entry?.symlink?.chain;
  const frontmatter = entry?.frontmatter;

  const [scrollOffset, setScrollOffset] = useState(0);

  const lines = useMemo(() => {
    const result: React.ReactElement[] = [];
    result.push(<Text key="title" bold>{node.label}</Text>);
    if (path !== undefined) {
      result.push(
        <Box key="path">
          <Text dimColor>Path: </Text>
          <Text>{path}</Text>
        </Box>
      );
    }
    if (symlinkChain && symlinkChain.length > 0) {
      result.push(<Text key="sym-header" dimColor>Symlink chain:</Text>);
      symlinkChain.forEach((hop, i) => {
        result.push(
          <Text key={`sym-${i}`}>{'  '}{theme.symlinkArrow} {hop}</Text>
        );
      });
    }
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      result.push(<Text key="fm-header" dimColor>Frontmatter:</Text>);
      Object.entries(frontmatter).forEach(([k, v]) => {
        result.push(<Text key={`fm-${k}`}>{'  '}{k}: {String(v)}</Text>);
      });
    }
    if (node.description) {
      result.push(<Text key="desc-header" dimColor>Description: </Text>);
      result.push(<Text key="desc">{node.description}</Text>);
    }
    result.push(
      <Box key="type">
        <Text dimColor>Type: </Text>
        <Text>{node.type}</Text>
      </Box>
    );
    return result;
  }, [node, path, symlinkChain, frontmatter]);

  const borderRows = 4;
  const footerRows = 2;
  const scrollableHeight = Math.max(1, height - borderRows - footerRows);

  useEffect(() => {
    setScrollOffset(0);
  }, [node]);

  const maxScroll = Math.max(0, lines.length - scrollableHeight);
  const visibleLines = lines.slice(scrollOffset, scrollOffset + scrollableHeight);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        onClose();
        return;
      }
      if (key.upArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((prev) => Math.min(maxScroll, prev + 1));
        return;
      }
    },
    { isActive: true }
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      paddingY={1}
      height={height}
      overflow="hidden"
    >
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>ESC/q: close | arrows: scroll</Text>
        {lines.length > scrollableHeight && (
          <Text dimColor>
            [{scrollOffset + 1}-{Math.min(scrollOffset + scrollableHeight, lines.length)}/{lines.length}]
          </Text>
        )}
      </Box>
    </Box>
  );
}
