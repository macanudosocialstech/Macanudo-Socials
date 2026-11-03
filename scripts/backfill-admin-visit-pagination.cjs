// Dry-run by default. Apply is guarded by explicit project and trigger acknowledgement.
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { collections } = require('../firebase-functions/redemptionStats.cjs');
const { syncRedemptionAdminMetadata } = require('../firebase-functions/redemptionAdminMetadata.cjs');
const META = '_adminVisitPaginationMeta';

function planSession(data, mappedStore) {
  const problems = [];
  const storeId = data.storeId || mappedStore;
  if (!storeId || typeof storeId !== 'string' || !storeId.trim()) problems.push('missing-store');
  if (data.storeId && mappedStore && data.storeId !== mappedStore) problems.push('mapping-conflict');
  if (!['pending', 'completed', 'expired'].includes(data.status)) problems.push('invalid-status');
  if (!data.checkInAt?.toDate || !Number.isFinite(data.checkInAt.toDate().getTime())) problems.push('missing-timestamp-checkInAt');
  if (data.status === 'pending' && data.checkOutAt) problems.push('pending-with-checkout');
  return { patch: !data.storeId && storeId ? { storeId } : {}, problems };
}

function planRedemption(data, session, mappedStore) {
  const storeId = session?.storeId || mappedStore;
  const problems = [];
  if (!session) problems.push('orphan-session');
  if (!storeId) problems.push('missing-session-store');
  if (data.storeId && data.storeId !== storeId) problems.push('store-conflict');
  if (!Array.isArray(data.redemptions)) problems.push('invalid-redemptions');
  const items = Array.isArray(data.redemptions) ? data.redemptions : [];
  if (items.some(item => !item || typeof item !== 'object')) problems.push('invalid-redemption-item');
  const statuses = [...new Set(items.filter(Boolean).map(item => item.status || 'completed'))].sort();
  if (statuses.some(status => !['pending', 'completed'].includes(status))) problems.push('unknown-redemption-status');
  const patch = {};
  if (!data.storeId && storeId) patch.storeId = storeId;
  if (JSON.stringify([...(data.adminStatuses || [])].sort()) !== JSON.stringify(statuses)) patch.adminStatuses = statuses;
  return { patch, problems };
}

function parseOptions(args) {
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const project = value('--project');
  if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('EXACT_PROJECT_REQUIRED');
  const apply = args.includes('--apply');
  if (apply && !args.includes('--trigger-deployed')) throw new Error('TRIGGER_DEPLOYMENT_ACKNOWLEDGEMENT_REQUIRED');
  return { project, apply, triggerDeployed: args.includes('--trigger-deployed'), mappingPath: value('--mapping'), plan: args.includes('--plan'), resumeRun: value('--resume-run') };
}

async function scan(db, collection, visit) {
  let cursor;
  while (true) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) await visit(document);
    if (page.size < 200) break;
    cursor = page.docs.at(-1);
  }
}

async function audit(db, mapping, emitPlan = false) {
  const counts = { sessions: 0, redemptionDocuments: 0, referralUsers: 0, patches: 0, unresolved: 0 };
  const samples = [];
  function report(collection, id, result) {
    if (Object.keys(result.patch).length) counts.patches++;
    if (result.problems.length) counts.unresolved++;
    if (result.problems.length && samples.length < 20) samples.push({ collection, id, problems: result.problems });
    if (emitPlan && (Object.keys(result.patch).length || result.problems.length)) console.log(JSON.stringify({ collection, id, ...result }));
  }
  await scan(db, collections.sessions, async document => {
    counts.sessions++;
    report(collections.sessions, document.id, planSession(document.data(), mapping.sessions?.[document.id]));
  });
  await scan(db, collections.records, async document => {
    counts.redemptionDocuments++;
    const data = document.data();
    const sessionId = data.visitSessionId || document.id;
    const session = await db.collection(collections.sessions).doc(sessionId).get();
    report(collections.records, document.id, planRedemption(data, session.data(), mapping.sessions?.[sessionId]));
  });
  // Referral rewards still live on users. Never infer a historical visit's
  // store from a user's current assignment.
  await scan(db, 'users', async document => {
    const data = document.data();
    if (!data.referral?.redeemedMilestones?.length) return;
    counts.referralUsers++;
    const storeId = data.storeId || mapping.users?.[document.id];
    const valid = typeof storeId === 'string' && !!storeId.trim();
    report('users', document.id, { patch: !data.storeId && valid ? { storeId } : {}, problems: valid ? [] : ['missing-referral-user-store'] });
  });
  return { ...counts, samples, dataReady: counts.patches === 0 && counts.unresolved === 0 };
}

async function applyMapping(db, collection, id, storeId) {
  if (typeof storeId !== 'string' || !storeId.trim()) throw new Error('INVALID_VERIFIED_MAPPING');
  await db.runTransaction(async tx => {
    const ref = db.collection(collection).doc(id);
    const current = await tx.get(ref);
    if (!current.exists) throw new Error('MAPPED_DOCUMENT_MISSING');
    if (current.data().storeId && current.data().storeId !== storeId) throw new Error('MAPPING_CONFLICT');
    if (!current.data().storeId) tx.update(ref, { storeId });
  });
}

async function runMigration(db, options, mapping = {}) {
  if (!options.project || db.projectId !== options.project) throw new Error('PROJECT_MISMATCH');
  if (options.apply && !options.triggerDeployed) throw new Error('TRIGGER_DEPLOYMENT_ACKNOWLEDGEMENT_REQUIRED');
  const preflight = await audit(db, mapping, options.plan);
  if (!options.apply) return { mode: 'dry-run', project: options.project, ...preflight };
  if (preflight.unresolved) throw new Error('UNRESOLVED_LEGACY_DATA');
  const meta = db.collection(META).doc('default');
  const runId = options.resumeRun || randomUUID();
  await db.runTransaction(async tx => {
    const existing = await tx.get(meta);
    if (existing.data()?.running && existing.data()?.runId !== options.resumeRun) throw new Error('MIGRATION_ALREADY_RUNNING');
    tx.set(meta, { ready: false, schemaVersion: 1, running: true, runId, projectId: options.project, startedAt: new Date() });
  });
  console.log(JSON.stringify({ mode: 'apply-started', project: options.project, runId }));
  try {
    for (const [id, storeId] of Object.entries(mapping.sessions || {})) await applyMapping(db, collections.sessions, id, storeId);
    for (const [id, storeId] of Object.entries(mapping.users || {})) await applyMapping(db, 'users', id, storeId);
    await scan(db, collections.records, document => syncRedemptionAdminMetadata(db, document.id));
    // No stale snapshot is ever used for a patch. Verify current sources again
    // before publishing readiness; retries can safely resume using the run ID.
    const verified = await audit(db, {});
    if (!verified.dataReady) throw new Error('POST_MIGRATION_VERIFICATION_FAILED');
    await db.runTransaction(async tx => {
      const current = await tx.get(meta);
      if (current.data()?.runId !== runId) throw new Error('NEWER_MIGRATION_RUNNING');
      if (current.data()?.invalidatedAt) throw new Error('CONCURRENT_METADATA_FAILURE');
      tx.update(meta, { ready: true, running: false, completedAt: new Date(), verified });
    });
    return { mode: 'applied', project: options.project, runId, ...verified };
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = await tx.get(meta);
      if (current.data()?.runId === runId) tx.update(meta, { ready: false, running: false, failedAt: new Date() });
    });
    throw error;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const mapping = options.mappingPath ? JSON.parse(readFileSync(options.mappingPath, 'utf8')) : {};
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault();
  initializeApp({ projectId: options.project, credential });
  const result = await runMigration(getFirestore(), options, mapping);
  console.log(JSON.stringify(result));
  if (result.unresolved) process.exitCode = 2;
}

module.exports = { planSession, planRedemption, parseOptions, applyMapping, runMigration };
if (require.main === module) main().catch(error => {
  console.error(error.code || 'MIGRATION_INCOMPLETE', /^[A-Z_]+$/.test(error.message) ? error.message : 'Check credentials, project, verified mappings and trigger readiness.');
  process.exitCode = 1;
});
