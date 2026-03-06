export interface AgentLensConfig {
  roots: string[];
}

export interface ProjectScan {
  path: string;
  configs: ToolConfig[];
}

export interface ScanResult {
  global: ToolConfig[];
  project: ToolConfig[];
  projectPath: string;
  projects?: ProjectScan[];
}

export interface ToolConfig {
  tool: string;
  category: string;
  label?: string;
  basePath: string;
  exists: boolean;
  entries: ConfigEntry[];
}

export interface ConfigEntry {
  name: string;
  path: string;
  exists: boolean;
  symlink?: SymlinkInfo;
  frontmatter?: Record<string, unknown>;
  description?: string;
}

export interface SymlinkInfo {
  raw: string;
  resolved: string;
  isRelative: boolean;
  chain: string[];
}

export interface McpServerEntry {
  name: string;
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  hasAuth: boolean;
}

export interface Diagnostic {
  severity: 'error' | 'warn' | 'info';
  code: string;
  message: string;
  path?: string;
  details?: string;
}

export interface TreeNode {
  id: string;
  label: string;
  type: 'scope' | 'tool' | 'category' | 'entry' | 'symlink-target';
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  children: TreeNode[];
  data?: ToolConfig | ConfigEntry;
  pathLabel?: string;
  symlinkTarget?: string;
  description?: string;
  diagnostic?: Diagnostic;
}
