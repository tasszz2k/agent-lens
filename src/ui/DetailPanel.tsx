import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import nodePath from 'node:path';
import type { TreeNode, ConfigEntry, LinkedEntry } from '../types.js';
import { theme } from './theme.js';

function resolvedDir(le: LinkedEntry): string {
  const target = le.symlinkTarget || le.path;
  if (target.endsWith(nodePath.basename(le.path))) {
    return nodePath.dirname(target);
  }
  return target;
}

interface DetailPanelProps {
  node: TreeNode;
  onClose: () => void;
  onToggleHelp: () => void;
  onNavigateToEntry: (path: string) => void;
  height: number;
  linkedEntries?: LinkedEntry[];
}

function getPath(node: TreeNode): string | undefined {
  const d = node.data;
  if (d && 'path' in d) return (d as ConfigEntry).path;
  if (d && 'basePath' in d) return d.basePath;
  return undefined;
}

interface LineItem {
  element: React.ReactElement;
  linkedIndex?: number;
}

export default function DetailPanel({ node, onClose, onToggleHelp, onNavigateToEntry, height, linkedEntries }: DetailPanelProps) {
  const path = getPath(node);
  const entry = node.data && 'path' in node.data ? (node.data as ConfigEntry) : null;
  const symlinkChain = entry?.symlink?.chain;
  const frontmatter = entry?.frontmatter;

  const [scrollOffset, setScrollOffset] = useState(0);
  const [linkedCursor, setLinkedCursor] = useState(-1);
  const [pendingG, setPendingG] = useState(false);

  const navigableLinked = useMemo(() => {
    if (!linkedEntries) return [];
    return linkedEntries.filter((le) => !le.isSelf);
  }, [linkedEntries]);

  const lines = useMemo(() => {
    const result: LineItem[] = [];
    result.push({ element: <Text key="title" bold>{node.label}</Text> });
    if (path !== undefined) {
      result.push({
        element: (
          <Box key="path">
            <Text dimColor>Path: </Text>
            <Text>{path}</Text>
          </Box>
        ),
      });
    }
    if (symlinkChain && symlinkChain.length > 0) {
      result.push({ element: <Text key="sym-header" dimColor>Symlink chain:</Text> });
      symlinkChain.forEach((hop, i) => {
        result.push({
          element: <Text key={`sym-${i}`}>{'  '}{theme.symlinkArrow} {hop}</Text>,
        });
      });
    }
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      result.push({ element: <Text key="fm-header" dimColor>Frontmatter:</Text> });
      Object.entries(frontmatter).forEach(([k, v]) => {
        result.push({
          element: <Text key={`fm-${k}`}>{'  '}{k}: {String(v)}</Text>,
        });
      });
    }
    const fullDescription = entry?.description || node.description;
    if (fullDescription) {
      result.push({ element: <Text key="desc-header" dimColor>Description: </Text> });
      result.push({ element: <Text key="desc" wrap="wrap">{fullDescription}</Text> });
    }
    result.push({
      element: (
        <Box key="type">
          <Text dimColor>Type: </Text>
          <Text>{node.type}</Text>
        </Box>
      ),
    });
    if (linkedEntries && linkedEntries.length > 0) {
      const selfDir = (() => {
        const self = linkedEntries.find((le) => le.isSelf);
        if (!self) return undefined;
        return resolvedDir(self);
      })();

      const linked: LinkedEntry[] = [];
      const crossRefs: LinkedEntry[] = [];
      for (const le of linkedEntries) {
        if (selfDir && resolvedDir(le) === selfDir) {
          linked.push(le);
        } else {
          crossRefs.push(le);
        }
      }

      let navIdx = 0;

      const renderEntry = (le: LinkedEntry, keyPrefix: string, i: number) => {
        const label = `${le.tool} (${le.scope})`;
        const arrow = le.symlinkTarget ? ` --> ${le.symlinkTarget}` : '';
        if (le.isSelf) {
          result.push({
            element: (
              <Text key={`${keyPrefix}-${i}`}>{'  '}<Text color="green" bold>* </Text><Text bold>{label}</Text><Text dimColor>  {le.path}{arrow}</Text></Text>
            ),
          });
        } else {
          result.push({
            element: (
              <Text key={`${keyPrefix}-${i}`}>{'  '}<Text dimColor>  </Text>{label}<Text dimColor>  {le.path}{arrow}</Text></Text>
            ),
            linkedIndex: navIdx,
          });
          navIdx++;
        }
      };

      if (linked.length > 0) {
        result.push({ element: <Text key="linked-spacer">{' '}</Text> });
        result.push({ element: <Text key="linked-header" bold dimColor>Linked ({linked.length}):</Text> });
        linked.forEach((le, i) => renderEntry(le, 'linked', i));
      }
      if (crossRefs.length > 0) {
        result.push({ element: <Text key="xref-spacer">{' '}</Text> });
        result.push({ element: <Text key="xref-header" bold dimColor>Cross-references ({crossRefs.length}):</Text> });
        crossRefs.forEach((le, i) => renderEntry(le, 'xref', i));
      }
    }
    return result;
  }, [node, path, symlinkChain, frontmatter, linkedEntries]);

  const borderRows = 4;
  const footerRows = 2;
  const scrollableHeight = Math.max(1, height - borderRows - footerRows);

  useEffect(() => {
    setScrollOffset(0);
    setLinkedCursor(-1);
  }, [node]);

  const maxScroll = Math.max(0, lines.length - scrollableHeight);

  const scrollToLine = useCallback((lineIdx: number) => {
    if (lineIdx < scrollOffset) {
      setScrollOffset(lineIdx);
    } else if (lineIdx >= scrollOffset + scrollableHeight) {
      setScrollOffset(Math.min(maxScroll, lineIdx - scrollableHeight + 1));
    }
  }, [scrollOffset, scrollableHeight, maxScroll]);

  const visibleLines = lines.slice(scrollOffset, scrollOffset + scrollableHeight);

  useInput(
    (input, key) => {
      if (pendingG) {
        setPendingG(false);
        if (input === 'g') {
          setScrollOffset(0);
          setLinkedCursor(-1);
        }
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
      if (key.return) {
        if (linkedCursor >= 0 && linkedCursor < navigableLinked.length) {
          onNavigateToEntry(navigableLinked[linkedCursor].path);
        }
        return;
      }
      if (key.upArrow || input === 'k') {
        if (navigableLinked.length > 0 && linkedCursor >= 0) {
          const next = linkedCursor - 1;
          if (next < 0) {
            setLinkedCursor(-1);
          } else {
            setLinkedCursor(next);
            const lineIdx = lines.findIndex((l) => l.linkedIndex === next);
            if (lineIdx >= 0) scrollToLine(lineIdx);
          }
        } else {
          setScrollOffset((prev) => Math.max(0, prev - 1));
        }
        return;
      }
      if (key.downArrow || input === 'j') {
        if (navigableLinked.length > 0 && linkedCursor < navigableLinked.length - 1) {
          const next = linkedCursor + 1;
          setLinkedCursor(next);
          const lineIdx = lines.findIndex((l) => l.linkedIndex === next);
          if (lineIdx >= 0) scrollToLine(lineIdx);
        } else if (linkedCursor === -1) {
          const newScroll = Math.min(maxScroll, scrollOffset + 1);
          setScrollOffset(newScroll);
          if (navigableLinked.length > 0 && newScroll >= maxScroll) {
            setLinkedCursor(0);
            const lineIdx = lines.findIndex((l) => l.linkedIndex === 0);
            if (lineIdx >= 0) scrollToLine(lineIdx);
          }
        }
        return;
      }
      if (input === 'G') {
        if (navigableLinked.length > 0) {
          const last = navigableLinked.length - 1;
          setLinkedCursor(last);
          setScrollOffset(maxScroll);
        } else {
          setScrollOffset(maxScroll);
        }
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
        setLinkedCursor(-1);
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
        {visibleLines.map(({ element, linkedIndex }, i) => {
          const isSelected = linkedIndex !== undefined && linkedIndex === linkedCursor;
          if (isSelected) {
            return <Text key={element.key ?? i} inverse>{element}</Text>;
          }
          return element;
        })}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>ESC/q: close | j/k: navigate{navigableLinked.length > 0 ? ' | enter: open' : ''}</Text>
        {lines.length > scrollableHeight && (
          <Text dimColor>
            [{scrollOffset + 1}-{Math.min(scrollOffset + scrollableHeight, lines.length)}/{lines.length}]
          </Text>
        )}
      </Box>
    </Box>
  );
}
