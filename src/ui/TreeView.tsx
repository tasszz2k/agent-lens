import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TreeNode } from '../types.js';
import { theme, tree } from './theme.js';
import cliTruncate from 'cli-truncate';

interface TreeViewProps {
  nodes: TreeNode[];
  searchQuery: string;
  onSelect: (node: TreeNode) => void;
  onQuit: () => void;
  onSearchActivate: () => void;
  onSearchClear: () => void;
  onToggleHelp: () => void;
  onOpenSettings: () => void;
  onCommandBarOpen: () => void;
  active: boolean;
  height: number;
  width: number;
  cursor: number;
  onCursorChange: (cursor: number) => void;
  scrollOffset: number;
  onScrollOffsetChange: (offset: number) => void;
  expandedOverride: Map<string, boolean>;
  onExpandedOverrideChange: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  focusNodeId?: string;
}

function renderNodeLine(
  node: TreeNode,
  prefix: string,
  isSelected: boolean,
  searchQuery: string,
  maxWidth: number,
  expanded: boolean
): React.ReactElement {
  const q = searchQuery.toLowerCase();
  const matchIdx = q.length > 0 ? node.label.toLowerCase().indexOf(q) : -1;

  let mainStyle: (s: string) => string;
  switch (node.type) {
    case 'scope':
      if (node.label.startsWith('CURRENT')) mainStyle = theme.scopeCurrent;
      else if (node.label.startsWith('GLOBAL')) mainStyle = theme.scopeGlobal;
      else mainStyle = theme.scopeProject;
      break;
    case 'tool':           mainStyle = theme.toolName; break;
    case 'category':       mainStyle = theme.category; break;
    case 'entry':
    case 'symlink-target': mainStyle = theme.toolName; break;
    default:               mainStyle = (s) => s;
  }

  let label: string;
  if (isSelected) {
    label = theme.selected(node.label);
  } else if (matchIdx >= 0 && q.length > 0) {
    const before = node.label.slice(0, matchIdx);
    const match = node.label.slice(matchIdx, matchIdx + q.length);
    const after = node.label.slice(matchIdx + q.length);
    label = mainStyle(before) + theme.searchHighlight(match) + mainStyle(after);
  } else {
    label = mainStyle(node.label);
  }

  let line = theme.treeLine(prefix) + label;

  if (node.type === 'scope' && node.hasChildren && !expanded && !isSelected) {
    line += ' ' + theme.dim('(l to expand)');
  }

  if (node.pathLabel && !isSelected) {
    line += ' ' + theme.path(node.pathLabel);
  }
  if (node.symlinkTarget) {
    line += ' ' + theme.symlinkArrow + ' ' + theme.symlinkTarget(node.symlinkTarget);
  }
  if (node.description && !isSelected) {
    const truncated = node.description.length > 50
      ? node.description.slice(0, 47) + '...'
      : node.description;
    line += ' ' + theme.description(truncated);
  }

  return <Text>{cliTruncate(line, maxWidth)}</Text>;
}

export default function TreeView({
  nodes,
  searchQuery,
  onSelect,
  onQuit,
  onSearchActivate,
  onSearchClear,
  onToggleHelp,
  onOpenSettings,
  onCommandBarOpen,
  active,
  height,
  width,
  cursor,
  onCursorChange: setCursor,
  scrollOffset,
  onScrollOffsetChange: setScrollOffset,
  expandedOverride,
  onExpandedOverrideChange: setExpandedOverride,
  focusNodeId,
}: TreeViewProps) {
  const [pendingG, setPendingG] = useState(false);

  const isExpanded = useCallback(
    (node: TreeNode) => {
      const over = expandedOverride.get(node.id);
      if (over !== undefined) return over;
      return node.expanded;
    },
    [expandedOverride]
  );

  const flattened = useMemo(() => {
    const out: { node: TreeNode; indent: string; branch: string }[] = [];
    function collect(ns: TreeNode[], indent: string) {
      for (let i = 0; i < ns.length; i++) {
        const node = ns[i];
        const isLast = i === ns.length - 1;
        const branch = isLast ? tree.last : tree.branch;
        out.push({ node, indent, branch });
        if (node.children.length > 0 && isExpanded(node)) {
          collect(node.children, indent + (isLast ? tree.space : tree.pipe));
        }
      }
    }
    collect(nodes, '');
    return out;
  }, [nodes, expandedOverride, isExpanded]);

  const visibleHeight = Math.max(0, height);

  useEffect(() => {
    if (flattened.length === 0) return;
    const idx = Math.min(cursor, flattened.length - 1);
    setCursor(idx);
    if (idx < scrollOffset) setScrollOffset(idx);
    else if (idx >= scrollOffset + visibleHeight)
      setScrollOffset(idx - visibleHeight + 1);
  }, [flattened.length, visibleHeight]);

  useEffect(() => {
    if (!focusNodeId || flattened.length === 0) return;
    const idx = flattened.findIndex((f) => f.node.id === focusNodeId);
    if (idx >= 0) {
      setCursor(idx);
      if (idx < scrollOffset) {
        setScrollOffset(idx);
      } else if (idx >= scrollOffset + visibleHeight) {
        setScrollOffset(Math.min(
          Math.max(0, flattened.length - visibleHeight),
          idx - visibleHeight + 1
        ));
      }
    }
  }, [focusNodeId]);

  const moveCursor = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(flattened.length - 1, target));
    setCursor(clamped);
    if (clamped < scrollOffset) {
      setScrollOffset(clamped);
    } else if (clamped >= scrollOffset + visibleHeight) {
      setScrollOffset(Math.min(
        Math.max(0, flattened.length - visibleHeight),
        clamped - visibleHeight + 1
      ));
    }
  }, [flattened.length, scrollOffset, visibleHeight, setCursor, setScrollOffset]);

  useInput(
    (input, key) => {
      if (!active) return;

      if (pendingG) {
        setPendingG(false);
        if (input === 'g') {
          moveCursor(0);
        }
        return;
      }

      if (key.escape) {
        if (searchQuery.length > 0) {
          onSearchClear();
        }
        return;
      }
      if (input === 'q') {
        onQuit();
        return;
      }
      if (input === '?') {
        onToggleHelp();
        return;
      }
      if (input === '/') {
        onSearchActivate();
        return;
      }
      if (input === ':') {
        onCommandBarOpen();
        return;
      }
      if (key.upArrow || input === 'k') {
        moveCursor(cursor - 1);
        return;
      }
      if (key.downArrow || input === 'j') {
        moveCursor(cursor + 1);
        return;
      }
      if (input === 'G') {
        moveCursor(flattened.length - 1);
        return;
      }
      if (input === 'g') {
        setPendingG(true);
        return;
      }
      if (input === 'c') {
        const idx = flattened.findIndex((f) => f.node.id.startsWith('scope:CURRENT'));
        if (idx >= 0) moveCursor(idx);
        return;
      }
      if (input === 's') {
        onOpenSettings();
        return;
      }
      if (key.ctrl && input === 'd') {
        moveCursor(cursor + Math.floor(visibleHeight / 2));
        return;
      }
      if (key.ctrl && input === 'u') {
        moveCursor(cursor - Math.floor(visibleHeight / 2));
        return;
      }
      if (key.leftArrow || input === 'h') {
        const item = flattened[cursor];
        if (!item) return;
        const { node } = item;
        if (node.children.length > 0 && isExpanded(node)) {
          setExpandedOverride((prev) => {
            const next = new Map(prev);
            next.set(node.id, false);
            return next;
          });
        } else {
          let parentIdx = -1;
          for (let i = cursor - 1; i >= 0; i--) {
            if (flattened[i].node.depth < node.depth) {
              parentIdx = i;
              break;
            }
          }
          if (parentIdx >= 0) setCursor(parentIdx);
        }
        return;
      }
      if (key.rightArrow || input === 'l') {
        const item = flattened[cursor];
        if (!item) return;
        const { node } = item;
        if (node.children.length > 0 && !isExpanded(node)) {
          setExpandedOverride((prev) => {
            const next = new Map(prev);
            next.set(node.id, true);
            return next;
          });
        }
        return;
      }
      if (key.return) {
        const item = flattened[cursor];
        if (item) onSelect(item.node);
      }
    },
    { isActive: active }
  );

  const visible = flattened.slice(
    scrollOffset,
    scrollOffset + visibleHeight
  );

  return (
    <Box flexDirection="column" flexGrow={1} width={width} overflow="hidden">
      {visible.map(({ node, indent, branch }, i) => {
        const globalIdx = scrollOffset + i;
        const isSelected = globalIdx === cursor;
        const fullPrefix = indent + branch;
        return (
          <Box key={node.id}>
            {renderNodeLine(
              node,
              fullPrefix,
              isSelected,
              searchQuery,
              width,
              isExpanded(node)
            )}
          </Box>
        );
      })}
    </Box>
  );
}
