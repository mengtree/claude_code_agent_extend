import assert from 'node:assert/strict';
import { mkdir, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from './Storage';

async function testStaleSessionsLockIsRecovered(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-storage-lock-test');
  await removeDirectoryWithRetry(workspacePath);

  try {
    const storage = new Storage(workspacePath);
    await storage.initialize();

    const staleLockPath = join(workspacePath, '.agent-extend', 'locks', 'sessions.lock');
    await mkdir(staleLockPath, { recursive: true });
    await utimes(staleLockPath, new Date('2000-01-01T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'));

    const session = await storage.withSessionsLock(async (sessions) => {
      const createdSession = {
        id: 'storage-lock-test-session',
        workspacePath,
        claudeProjectPath: workspacePath,
        status: 'active' as const,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
        lastActiveAt: '2026-03-10T00:00:00.000Z',
        interruptRequested: false,
        externalMappings: []
      };

      sessions.push(createdSession);
      await storage.writeSessionsUnsafe(sessions);
      return createdSession;
    });

    const savedSessions = await storage.loadSessions();
    assert.equal(session.id, 'storage-lock-test-session');
    assert.equal(savedSessions.length, 1);
    assert.equal(savedSessions[0].id, 'storage-lock-test-session');
  } finally {
    await removeDirectoryWithRetry(workspacePath);
  }
}

async function removeDirectoryWithRetry(directoryPath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directoryPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  }
}

async function main(): Promise<void> {
  await testStaleSessionsLockIsRecovered();
  console.log('Storage tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});