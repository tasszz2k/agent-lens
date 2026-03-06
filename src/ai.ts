import { spawn, execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { Diagnostic } from './types.js';

export async function isClaudeAvailable(): Promise<boolean> {
  try {
    const cmd = platform() === 'win32' ? 'where' : 'which';
    execSync(`${cmd} claude`, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

export function askClaude(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--print'], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.write(prompt);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`claude exited with code ${code}`);
      }
      resolve();
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(err.message);
      }
      resolve();
    });
  });
}

function formatDiagnostic(d: Diagnostic): string {
  let out = `[${d.severity.toUpperCase()}] (${d.code}) ${d.message}`;
  if (d.path) out += `\n  Path: ${d.path}`;
  if (d.details) out += `\n  Details: ${d.details}`;
  return out;
}

export async function analyzeWithClaude(
  diagnostics: Diagnostic[],
  context?: string
): Promise<void> {
  if (!(await isClaudeAvailable())) return;

  const parts: string[] = [
    'You are an AI coding tool configuration expert. Analyze these issues found in the user\'s agent configuration and provide actionable fixes.',
    '',
    diagnostics.map(formatDiagnostic).join('\n\n'),
  ];
  if (context) {
    parts.push('', 'Additional context:', context);
  }
  parts.push(
    '',
    'Provide concise, actionable recommendations. Reference specific file paths.'
  );

  await askClaude(parts.join('\n'));
}
