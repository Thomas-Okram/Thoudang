import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { transaction, type Db } from '../db/client.js';
import { auditLog, cases, uploadSessions } from '../db/schema.js';

/**
 * Restores the primed demo state: removes live (non-historical) cases and upload sessions and
 * their files. Keeps the extraction cache, notice audio, officers, templates and synthetic
 * historical cases. The audit log is append-only, so the reset itself is recorded there.
 */
export async function resetDemo(
  db: Db,
  uploadsDir: string,
  actor: string,
): Promise<{ cases: number; sessions: number }> {
  const live = await db.select({ id: cases.id }).from(cases).where(eq(cases.historical, false));
  const sessions = await db.select({ id: uploadSessions.id }).from(uploadSessions);
  await transaction(db, async (tx) => {
    await tx.delete(cases).where(eq(cases.historical, false)); // cascades documents/extractions/flags
    await tx.delete(uploadSessions); // cascades session_files
  });
  for (const id of live.map((c) => c.id))
    fs.rmSync(path.join(uploadsDir, id), { recursive: true, force: true });
  fs.rmSync(path.join(uploadsDir, 'sessions'), { recursive: true, force: true });
  await db.insert(auditLog).values({
    caseId: null,
    actor,
    action: 'DEMO_RESET',
    entityType: 'system',
    entityId: null,
    after: { cases: live.length, sessions: sessions.length },
  });
  return { cases: live.length, sessions: sessions.length };
}
