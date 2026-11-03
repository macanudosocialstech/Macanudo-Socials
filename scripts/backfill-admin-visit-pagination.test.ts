import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { planSession, planRedemption, parseOptions, runMigration } = require('./backfill-admin-visit-pagination.cjs');
describe('guarded admin pagination migration', () => {
  it('requires explicit legacy store mapping and does not guess from member data', () => {
    const data = { status: 'completed', checkInAt: { toDate: () => new Date() } };
    expect(planSession(data).problems).toContain('missing-store');
    expect(planSession(data, 'verified-store')).toEqual({ patch: { storeId: 'verified-store' }, problems: [] });
  });
  it('projects grouped statuses without rewriting financial or redemption data', () => {
    const data = { redemptions: [{ status: 'pending', quantity: 2 }, { quantity: 1 }] };
    expect(planRedemption(data, { storeId: 's' })).toEqual({ patch: { storeId: 's', adminStatuses: ['completed', 'pending'] }, problems: [] });
    expect(data.redemptions).toHaveLength(2);
    expect(planRedemption({ ...data, storeId: 'wrong' }, { storeId: 's' }).problems).toContain('store-conflict');
    expect(planRedemption(data).problems).toContain('orphan-session');
  });
  it('requires an exact project and deployed-trigger acknowledgement', () => {
    expect(() => parseOptions([])).toThrow('EXACT_PROJECT_REQUIRED');
    expect(() => parseOptions(['--project', 'test-project', '--apply'])).toThrow('TRIGGER_DEPLOYMENT_ACKNOWLEDGEMENT_REQUIRED');
    expect(parseOptions(['--project', 'test-project']).apply).toBe(false);
  });
  function database() {
    const documents = new Map<string, any>([
      ['visitSessions/visit', { status: 'completed', checkInAt: { toDate: () => new Date() }, pointsDeducted: 250 }],
      ['redemptionRecords/visit', { redemptions: [{ status: 'pending', quantity: 2 }], financialValue: 999 }],
    ]);
    let writes = 0;
    const snapshot = (path: string) => ({ id: path.split('/')[1], exists: documents.has(path), data: () => documents.get(path) });
    const db: any = {
      projectId: 'test-project',
      collection: (name: string) => {
        const q: any = { orderBy: () => q, limit: () => q,
          get: async () => { const docs = [...documents.keys()].filter(path => path.startsWith(`${name}/`)).map(snapshot); return { docs, size: docs.length }; },
          doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }),
        };
        return q;
      },
      runTransaction: async (fn: any) => fn({ get: async (ref: any) => snapshot(ref.path),
        set: (ref: any, data: any) => { writes++; documents.set(ref.path, data); },
        update: (ref: any, data: any) => { writes++; documents.set(ref.path, { ...documents.get(ref.path), ...data }); },
      }),
    };
    return { db, documents, writes: () => writes };
  }
  it('dry-runs without writes, then safely applies verified mappings and publishes readiness', async () => {
    const fake = database();
    const mapping = { sessions: { visit: 'verified-store' } };
    const options = { project: 'test-project', apply: false };
    expect((await runMigration(fake.db, options, mapping)).patches).toBe(2);
    expect(fake.writes()).toBe(0);
    await runMigration(fake.db, { ...options, apply: true, triggerDeployed: true }, mapping);
    expect(fake.documents.get('_adminVisitPaginationMeta/default').ready).toBe(true);
    expect(fake.documents.get('redemptionRecords/visit')).toMatchObject({ storeId: 'verified-store', adminStatuses: ['pending'], financialValue: 999 });
    expect(fake.documents.get('visitSessions/visit').pointsDeducted).toBe(250);
  });
  it('refuses unresolved sources, wrong projects, and overlapping migration runs', async () => {
    const fake = database();
    const options = { project: 'test-project', apply: true, triggerDeployed: true };
    await expect(runMigration(fake.db, options)).rejects.toThrow('UNRESOLVED_LEGACY_DATA');
    await expect(runMigration(fake.db, { ...options, project: 'wrong-project' })).rejects.toThrow('PROJECT_MISMATCH');
    fake.documents.set('_adminVisitPaginationMeta/default', { running: true, runId: 'other' });
    await expect(runMigration(fake.db, options, { sessions: { visit: 'verified-store' } })).rejects.toThrow('MIGRATION_ALREADY_RUNNING');
    expect(fake.writes()).toBe(0);
  });
});
