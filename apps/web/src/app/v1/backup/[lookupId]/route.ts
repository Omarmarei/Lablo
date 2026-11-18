// The encrypted backup (RELAY step 32a): the TV's put, get and delete. The work is in src/server/backup.ts.
import { BACKUP_WRITE_HEADER } from '@lablo/protocol';
import { backupRoute, deleteBackup, getBackup, putBackup } from '../../../../server/backup';
import { preflight } from '../../../../server/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ lookupId: string }> };

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { lookupId } = await context.params;
  return backupRoute('put', (deps) => putBackup(deps, request, lookupId));
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { lookupId } = await context.params;
  return backupRoute('get', (deps) => getBackup(deps, request, lookupId));
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { lookupId } = await context.params;
  return backupRoute('delete', (deps) => deleteBackup(deps, request, lookupId));
}

export function OPTIONS(): Response {
  return preflight('PUT, GET, DELETE', `content-type, ${BACKUP_WRITE_HEADER}`);
}
