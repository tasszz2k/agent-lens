import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import TreeView from './TreeView.js';
import SearchBar from './SearchBar.js';
import DetailPanel from './DetailPanel.js';
import HelpBar from './HelpBar.js';
import { theme } from './theme.js';
import type { ScanResult, TreeNode, ToolConfig, ConfigEntry, Diagnostic, LinkedEntry } from '../types.js';
import path from 'node:path';
import os from 'node:os';

function tildify(p: string): string {
  const home = os.homedir();
  if (p === home || p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function truncateDesc(s: string, max = 50): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function groupByTool(configs: ToolConfig[]): Map<string, ToolConfig[]> {
  const map = new Map<string, ToolConfig[]>();
  for (const tc of configs) {
    const list = map.get(tc.tool) ?? [];
    list.push(tc);
    map.set(tc.tool, list);
  }
  return map;
}

export function buildTreeFromScan(result: ScanResult): TreeNode[] {
  const roots: TreeNode[] = [];

  function makeScope(
    label: string,
    configs: ToolConfig[],
    tildifyPath: (p: string) => string
  ): TreeNode {
    const byTool = groupByTool(configs);
    const children: TreeNode[] = [];
    for (const [, toolConfigs] of byTool) {
      const toolNode = makeToolNode(toolConfigs, tildifyPath);
      children.push(toolNode);
    }
    return {
      id: `scope:${label}`,
      label,
      type: 'scope',
      depth: 0,
      expanded: true,
      hasChildren: children.length > 0,
      children,
    };
  }

  function makeToolNode(
    configs: ToolConfig[],
    tildifyPath: (p: string) => string
  ): TreeNode {
    const toolName = configs[0].tool;
    const children: TreeNode[] = configs.map((tc) =>
      makeCategoryNode(tc, tildifyPath)
    );
    return {
      id: `tool:${toolName}:${configs[0].basePath}`,
      label: toolName,
      type: 'tool',
      depth: 1,
      expanded: true,
      hasChildren: children.length > 0,
      children,
      data: configs[0],
    };
  }

  function makeCategoryNode(
    tc: ToolConfig,
    tildifyPath: (p: string) => string
  ): TreeNode {
    const pathLabel = tildifyPath(tc.basePath) + (tc.category === 'Context' ? '' : path.sep);
    const children: TreeNode[] = [];
    if (tc.entries.length === 0 && !tc.exists) {
      children.push({
        id: `empty:${tc.basePath}`,
        label: '(not found)',
        type: 'entry',
        depth: 3,
        expanded: false,
        hasChildren: false,
        children: [],
      });
    } else if (tc.entries.length === 0) {
      children.push({
        id: `empty:${tc.basePath}`,
        label: '(empty)',
        type: 'entry',
        depth: 3,
        expanded: false,
        hasChildren: false,
        children: [],
      });
    } else {
      for (const e of tc.entries) {
        const isMcpOrHooks = tc.category === 'MCP Servers' || tc.category === 'Hooks';
        const displayName = isMcpOrHooks
          ? e.name
          : e.path.endsWith('SKILL.md')
            ? e.name + '/SKILL.md'
            : path.basename(e.path);
        const entryNode: TreeNode = {
          id: `entry:${e.path}:${e.name}`,
          label: displayName,
          type: 'entry',
          depth: 3,
          expanded: false,
          hasChildren: false,
          children: [],
          data: e,
          pathLabel: e.path,
          symlinkTarget: e.symlink?.resolved,
          description: e.description ? truncateDesc(e.description) : undefined,
        };
        children.push(entryNode);
      }
    }
    const labelExtra = tc.label ? ` ${tc.label}` : '';
    return {
      id: `cat:${tc.tool}:${tc.category}:${tc.basePath}`,
      label: tc.category + labelExtra,
      type: 'category',
      depth: 2,
      expanded: true,
      hasChildren: children.length > 0,
      children,
      data: tc,
      pathLabel,
    };
  }

  roots.push(
    makeScope('GLOBAL', result.global, tildify)
  );
  roots.push(
    makeScope(`PROJECT ${tildify(result.projectPath)}`, result.project, tildify)
  );

  if (result.projects && result.projects.length > 0) {
    for (const proj of result.projects) {
      roots.push(
        makeScope(`PROJECT ${tildify(proj.path)}`, proj.configs, tildify)
      );
    }
  }

  return roots;
}

export function buildCrossRefIndex(result: ScanResult): Map<string, LinkedEntry[]> {
  const index = new Map<string, LinkedEntry[]>();

  function collect(configs: ToolConfig[], scope: string): void {
    for (const tc of configs) {
      for (const entry of tc.entries) {
        const key = entry.name;
        const linked: LinkedEntry = {
          tool: tc.tool,
          scope,
          category: tc.category,
          path: entry.path,
          symlinkTarget: entry.symlink?.resolved,
          isSelf: false,
        };
        const list = index.get(key) ?? [];
        list.push(linked);
        index.set(key, list);
      }
    }
  }

  collect(result.global, 'global');
  collect(result.project, tildify(result.projectPath));
  if (result.projects) {
    for (const proj of result.projects) {
      collect(proj.configs, tildify(proj.path));
    }
  }

  return index;
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.toLowerCase().trim();
  if (q.length === 0) return nodes;

  function matches(node: TreeNode): boolean {
    const labelMatch = node.label.toLowerCase().includes(q);
    const pathMatch = node.pathLabel?.toLowerCase().includes(q);
    const descMatch = node.description?.toLowerCase().includes(q);
    return labelMatch || pathMatch || (descMatch ?? false);
  }

  function filterRecurse(ns: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const n of ns) {
      const childMatch = filterRecurse(n.children);
      const selfMatch = matches(n);
      if (selfMatch || childMatch.length > 0) {
        out.push({
          ...n,
          children: childMatch.length > 0 ? childMatch : n.children,
          expanded: true,
        });
      }
    }
    return out;
  }

  return filterRecurse(nodes);
}

interface AppProps {
  scanResult: ScanResult;
  diagnostics: Diagnostic[];
  mode: 'scan' | 'where';
}

export default function App({
  scanResult,
  diagnostics,
  mode,
}: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<'tree' | 'detail'>('tree');
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [treeCursor, setTreeCursor] = useState(0);
  const [treeScrollOffset, setTreeScrollOffset] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>();
  const [showHelp, setShowHelp] = useState(true);
  const [terminalRows, setTerminalRows] = useState(process.stdout?.rows ?? 24);
  const [terminalCols, setTerminalCols] = useState(process.stdout?.columns ?? 80);

  useEffect(() => {
    const onResize = () => {
      setTerminalRows(process.stdout?.rows ?? 24);
      setTerminalCols(process.stdout?.columns ?? 80);
    };
    process.stdout?.on('resize', onResize);
    return () => {
      process.stdout?.off('resize', onResize);
    };
  }, []);

  const treeNodes = useMemo(
    () => buildTreeFromScan(scanResult),
    [scanResult]
  );

  const crossRef = useMemo(
    () => buildCrossRefIndex(scanResult),
    [scanResult]
  );

  const filteredNodes = useMemo(
    () => filterTree(treeNodes, searchQuery),
    [treeNodes, searchQuery]
  );

  const findNodeByPath = useCallback((entryPath: string): TreeNode | null => {
    function search(nodes: TreeNode[]): TreeNode | null {
      for (const n of nodes) {
        const d = n.data;
        if (d && 'path' in d && (d as ConfigEntry).path === entryPath) return n;
        const found = search(n.children);
        if (found) return found;
      }
      return null;
    }
    return search(treeNodes);
  }, [treeNodes]);

  const handleSelect = useCallback((node: TreeNode) => {
    setSelectedNode(node);
    setView('detail');
  }, []);

  const handleNavigateToEntry = useCallback((entryPath: string) => {
    const target = findNodeByPath(entryPath);
    if (target) {
      setSelectedNode(target);
    }
  }, [findNodeByPath]);


  const handleSearchActivate = useCallback(() => {
    setSearchActive(true);
  }, []);

  const handleSearchClose = useCallback((clearQuery = false) => {
    setSearchActive(false);
    if (clearQuery) setSearchQuery('');
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  const handleDetailClose = useCallback(() => {
    if (selectedNode) {
      setFocusNodeId(selectedNode.id);
    }
    setView('tree');
    setSelectedNode(null);
  }, [selectedNode]);

  const handleToggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  const searchBarVisible = (searchActive && view === 'tree') || searchQuery.length > 0;
  const helpBarRows = showHelp ? 2 : 0;
  const footerRows = (searchBarVisible ? 1 : 0) + (diagnostics.length > 0 ? 1 : 0);
  const contentHeight = Math.max(1, terminalRows - 2 - helpBarRows - footerRows);

  return (
    <Box flexDirection="column" width="100%" height={terminalRows} overflow="hidden">
      <Box justifyContent="space-between" width={terminalCols}>
        <Text>{theme.title('AGENTLENS')}</Text>
        <Text dimColor>{'<?> help'}</Text>
      </Box>
      {showHelp && <HelpBar view={view} width={terminalCols} />}
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Box flexGrow={1} flexDirection="column">
        {view === 'tree' && (
          <TreeView
            nodes={filteredNodes}
            searchQuery={searchQuery}
            onSelect={handleSelect}
            onQuit={handleQuit}
            onSearchActivate={handleSearchActivate}
            onSearchClear={handleSearchClear}
            onToggleHelp={handleToggleHelp}
            active={!searchActive}
            height={contentHeight}
            width={terminalCols}
            cursor={treeCursor}
            onCursorChange={setTreeCursor}
            scrollOffset={treeScrollOffset}
            onScrollOffsetChange={setTreeScrollOffset}
            focusNodeId={focusNodeId}
          />
        )}
        {view === 'detail' && selectedNode && (
          <DetailPanel
            node={selectedNode}
            onClose={handleDetailClose}
            onToggleHelp={handleToggleHelp}
            onNavigateToEntry={handleNavigateToEntry}
            height={contentHeight}
            linkedEntries={(() => {
              const entry = selectedNode.data && 'path' in selectedNode.data
                ? selectedNode.data as ConfigEntry
                : null;
              if (!entry) return undefined;
              const all = crossRef.get(entry.name);
              if (!all || all.length <= 1) return undefined;
              return all.map((le) => ({
                ...le,
                isSelf: le.path === entry.path,
              }));
            })()}
          />
        )}
      </Box>
      <SearchBar
        active={searchActive && view === 'tree'}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onClose={(clear) => handleSearchClose(clear)}
      />
      {diagnostics.length > 0 && (
        <Text>
          {diagnostics.length} issue
          {diagnostics.length === 1 ? '' : 's'} found (
          {diagnostics.filter((d) => d.severity === 'error').length} error
          {diagnostics.filter((d) => d.severity === 'error').length === 1 ? '' : 's'}
          , {diagnostics.filter((d) => d.severity === 'warn').length} warning
          {diagnostics.filter((d) => d.severity === 'warn').length === 1 ? '' : 's'}
          )
        </Text>
      )}
    </Box>
  );
}
