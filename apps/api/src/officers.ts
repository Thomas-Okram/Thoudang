import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { officers, type OfficerRole } from './db/schema.js';

export type Officer = typeof officers.$inferSelect;

/** Demo users — no passwords. Identity is chosen in the header dropdown; roles are enforced here. */
export const SEED_OFFICERS: Officer[] = [
  { id: 'dswo-imphal-west', name: 'DSWO Imphal West', role: 'DSWO', district: 'Imphal West' },
  {
    id: 'da-imphal-west',
    name: 'Dealing Assistant',
    role: 'DEALING_ASSISTANT',
    district: 'Imphal West',
  },
];

export type Permission =
  | 'approve'
  | 'resolve_flag'
  | 'edit_field'
  | 'add_note'
  | 'send_for_correction'
  | 'forward'
  | 'edit_templates';

const PERMISSIONS: Record<OfficerRole, readonly Permission[]> = {
  DSWO: [
    'approve',
    'resolve_flag',
    'edit_field',
    'add_note',
    'send_for_correction',
    'forward',
    'edit_templates',
  ],
  DEALING_ASSISTANT: [
    'resolve_flag',
    'edit_field',
    'add_note',
    'send_for_correction',
    'forward',
    'edit_templates',
  ],
};

export const ROLE_LABEL: Record<OfficerRole, string> = {
  DSWO: 'District Social Welfare Officer',
  DEALING_ASSISTANT: 'Dealing Assistant',
};

export function can(role: OfficerRole, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: OfficerRole): readonly Permission[] {
  return PERMISSIONS[role];
}

export async function ensureOfficers(db: Db): Promise<void> {
  for (const o of SEED_OFFICERS) {
    await db
      .insert(officers)
      .values(o)
      .onConflictDoUpdate({
        target: officers.id,
        set: { name: o.name, role: o.role, district: o.district },
      });
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Resolves the acting officer from the X-Officer-Id header and checks the permission. */
export async function requireOfficer(
  db: Db,
  req: Request,
  permission: Permission,
): Promise<Officer> {
  const id = req.header('x-officer-id');
  if (!id)
    throw new HttpError(401, 'Choose an officer (X-Officer-Id header) to perform this action');
  const [officer] = await db.select().from(officers).where(eq(officers.id, id)).limit(1);
  if (!officer) throw new HttpError(401, 'Unknown officer');
  if (!can(officer.role, permission)) {
    throw new HttpError(
      403,
      `${ROLE_LABEL[officer.role]} is not allowed to ${permission.replace(/_/g, ' ')}`,
    );
  }
  return officer;
}

export const officerActor = (o: Officer) => `officer:${o.id}`;
