import { doc, getDocFromServer } from './monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';

export type AdminStoreScope = { allStores: true } | { allStores: false; storeId: string };

export async function requireAdminVisitPagination() {
  if (import.meta.env.VITE_ADMIN_VISIT_PAGINATION_READY !== 'true') throw new Error('ADMIN_VISIT_MIGRATION_REQUIRED');
  const readiness = await getDocFromServer(doc(db, GLOBAL_COLLECTIONS.ADMIN_VISIT_PAGINATION_META, 'default'));
  if (!readiness.exists() || readiness.data().ready !== true || readiness.data().schemaVersion !== 1) {
    throw new Error('ADMIN_VISIT_MIGRATION_REQUIRED');
  }
}
