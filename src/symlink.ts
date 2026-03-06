import fs from 'node:fs/promises';
import path from 'node:path';
import type { SymlinkInfo } from './types.js';

export async function traceSymlink(filePath: string): Promise<SymlinkInfo | undefined> {
  try {
    const stats = await fs.lstat(filePath);
    if (!stats.isSymbolicLink()) {
      return undefined;
    }
    const raw = await fs.readlink(filePath);
    const chain = await resolveSymlinkChain(filePath);
    if (chain.length < 2) return undefined;
    const resolved = chain[chain.length - 1]!;
    const isRelative = !path.isAbsolute(raw);
    return {
      raw,
      resolved,
      isRelative,
      chain: [path.resolve(filePath), ...chain],
    };
  } catch {
    return undefined;
  }
}

export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function resolveSymlinkChain(filePath: string): Promise<string[]> {
  const chain: string[] = [];
  let current = path.resolve(filePath);

  try {
    let stats = await fs.lstat(current);
    if (!stats.isSymbolicLink()) {
      return chain;
    }

    while (stats.isSymbolicLink()) {
      const raw = await fs.readlink(current);
      chain.push(raw);
      current = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(current), raw);
      stats = await fs.lstat(current);
    }
    chain.push(current);
    return chain;
  } catch {
    return chain;
  }
}
