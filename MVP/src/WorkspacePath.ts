import { resolve } from 'node:path';

export function normalizeWorkspacePath(inputPath: string): string {
  const resolvedPath = resolve(inputPath);

  if (/^[a-z]:/.test(resolvedPath)) {
    return `${resolvedPath[0].toUpperCase()}${resolvedPath.slice(1)}`;
  }

  return resolvedPath;
}