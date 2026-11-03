import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, query, where, withMonitoringOperation } from './monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import { completedMemberVisitHours } from '../../utils/memberVisitStats';

export interface VisitMemberStatsState {
  userId: string;
  status: 'loading' | 'ready' | 'initializing' | 'error';
  completedHours: number | null;
}

export function subscribeToVisitMemberStats(userId: string, listener: (value: VisitMemberStatsState) => void) {
  let active = true, ready = false, failed = false, confirmedMissing = false;
  let completedHours: number | null = null;
  const emit = () => {
    if (active) listener({ userId, completedHours, status: failed || (ready && confirmedMissing) ? 'error'
      : !ready ? 'initializing' : completedHours === null ? 'loading' : 'ready' });
  };
  const error = () => { failed = true; emit(); };
  const stopMeta = onSnapshot(withMonitoringOperation(doc(db, GLOBAL_COLLECTIONS.VISIT_MEMBER_STATS_META, 'default'), 'home.memberStats'), { includeMetadataChanges: true }, snapshot => {
    // A cached readiness gate must never authorize an incomplete local summary.
    ready = !snapshot.metadata.fromCache && snapshot.data()?.ready === true && snapshot.data()?.version === 1;
    emit();
  }, error);
  const stopStats = onSnapshot(withMonitoringOperation(doc(db, GLOBAL_COLLECTIONS.VISIT_MEMBER_STATS, userId), 'home.memberStats'), { includeMetadataChanges: true }, snapshot => {
    const value = snapshot.data();
    completedHours = null;
    confirmedMissing = !snapshot.metadata.fromCache && !snapshot.exists();
    if (!snapshot.metadata.fromCache && !snapshot.exists()) {
      // Backfill creates explicit zero documents for all users; missing is not zero.
      emit(); return;
    }
    if (!snapshot.metadata.fromCache && value) {
      if (value.version !== 1 || value.userId !== userId || typeof value.completedHours !== 'number'
        || !Number.isFinite(value.completedHours) || value.completedHours < 0) { error(); return; }
      completedHours = value.completedHours;
    }
    emit();
  }, error);
  return () => { active = false; stopMeta(); stopStats(); };
}

// Deployment/backfill fallback. Do not use the legacy helper: it turns read failures into [].
export async function readCompletedMemberVisitHours(userId: string): Promise<number> {
  const snapshot = await getDocsFromServer(withMonitoringOperation(
    query(collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS), where('userId', '==', userId)), 'home.memberStats'));
  return completedMemberVisitHours(snapshot.docs.map(row => row.data()));
}

/** Eligibility callers must propagate this error, never substitute base limits or zero. */
export async function readReadyCompletedMemberVisitHours(userId: string): Promise<number> {
  const metaRef = withMonitoringOperation(doc(db, GLOBAL_COLLECTIONS.VISIT_MEMBER_STATS_META, 'default'), 'home.memberStats');
  const meta = await getDocFromServer(metaRef);
  if (meta.data()?.ready !== true || meta.data()?.version !== 1) throw new Error('VISIT_STATS_NOT_READY');
  const stats = await getDocFromServer(withMonitoringOperation(doc(db, GLOBAL_COLLECTIONS.VISIT_MEMBER_STATS, userId), 'home.memberStats'));
  const value = stats.data();
  if (!value || value.version !== 1 || value.userId !== userId || typeof value.completedHours !== 'number'
    || !Number.isFinite(value.completedHours) || value.completedHours < 0) throw new Error('VISIT_STATS_NOT_READY');
  // Detect a backfill started while the member document was being read.
  const confirmed = await getDocFromServer(metaRef);
  if (confirmed.data()?.ready !== true || confirmed.data()?.version !== 1
    || confirmed.data()?.runId !== meta.data()?.runId) throw new Error('VISIT_STATS_NOT_READY');
  return value.completedHours;
}
