// One-off repair. Defaults to preview; --apply commits an atomic, audited repair.
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../src/config/globalCollections.ts';

async function main() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error('CREDENTIAL_FILE_REQUIRED');
  const account = JSON.parse(readFileSync(path, 'utf8'));
  if (account.project_id !== 'macanudosocial') throw new Error('WRONG_PROJECT');
  initializeApp({ credential: cert(account) });
  const db = getFirestore();
  const userId = 'fbqW0xx80cd56j3jrYEXcqr2wtU2';
  const reloadId = 'zOqFX6OLe3QimLyVHFh1';
  const repairId = 'repair_atikah_20261007';
  const userRef = db.collection(C.USERS).doc(userId);
  const reloadRef = db.collection(C.RELOAD_RECORDS).doc(reloadId);
  const feeRef = db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(repairId);
  const renewalRef = db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(`${repairId}_renewal`);
  const pointsRef = db.collection(C.POINTS_RECORDS).doc(`${repairId}_fee`);
  const orderRef = db.collection(C.MEMBERSHIP_PAYMENTS).doc(repairId);
  const auditRef = db.collection(C.AUDIT_LOGS).doc(repairId);
  const from = Timestamp.fromDate(new Date('2026-10-07T12:34:00+08:00'));
  const until = Timestamp.fromDate(new Date('2027-10-07T12:34:00+08:00'));
  const apply = process.argv.includes('--apply');
  const result = await db.runTransaction(async tx => {
    const [userDoc, reloadDoc, feeDoc, renewalDoc, pointsDoc, orderDoc, auditDoc, fees, creditDoc] = await Promise.all([
      tx.get(userRef), tx.get(reloadRef), tx.get(feeRef), tx.get(renewalRef), tx.get(pointsRef), tx.get(orderRef), tx.get(auditRef),
      tx.get(db.collection(C.MEMBERSHIP_FEE_RECORDS).where('userId', '==', userId)),
      tx.get(db.collection(C.POINTS_RECORDS).doc('1CN38dY6z89rLsbQJ7YD')),
    ]);
    if (auditDoc.exists) return { status: 'already_applied', balance: userDoc.data()?.membership?.points };
    if (!userDoc.exists || !reloadDoc.exists || !creditDoc.exists) throw new Error('REQUIRED_RECORD_MISSING');
    const user = userDoc.data()!, reload = reloadDoc.data()!, credit = creditDoc.data()!;
    if (user.memberId !== '40WBH6' || user.email !== 'xtikahomar114@gmail.com'
      || user.status !== 'active' || user.role !== 'vip' || user.membership?.points !== 255
      || user.membership?.activeFrom || user.membership?.activeUntil || user.membership?.currentVisitSessionId
      || reload.userId !== userId || reload.status !== 'completed' || reload.requestedAmount !== 300
      || reload.pointsEquivalent !== 300 || reload.annualFeeAmount || reload.membershipOrderId
      || credit.userId !== userId || credit.type !== 'earn' || credit.amount !== 300
      || feeDoc.exists || renewalDoc.exists || pointsDoc.exists || orderDoc.exists || !fees.empty) {
      throw new Error('STATE_CHANGED_REVIEW_REQUIRED');
    }
    const balance = 56, now = Timestamp.now();
    const note = 'Owner-authorized repair: original membership activation failed; account was manually activated. Activation restored to 2026-10-07 12:34 UTC+8; annual fee deducted at repair time.';
    if (apply) {
      tx.update(userRef, { 'membership.points': balance, 'membership.activeFrom': from,
        'membership.activeUntil': until, 'membership.firstActivatedAt': from,
        'membership.nextFirstVisitWaiverExpiresAt': null, updatedAt: now });
      tx.create(pointsRef, { userId, userName: user.displayName, type: 'spend', amount: 199,
        source: 'membership_fee', relatedId: feeRef.id, balance, createdAt: now,
        createdBy: 'system_membership_repair', description: note });
      tx.create(feeRef, { userId, userName: user.displayName, amount: 199, renewalType: 'initial',
        status: 'paid', dueDate: from, deductedAt: now, pointsRecordId: pointsRef.id,
        storeId: reload.storeId || null, createdAt: now, updatedAt: now, repairId, notes: note });
      tx.create(renewalRef, { userId, userName: user.displayName, amount: 199, renewalType: 'renewal',
        status: 'pending', dueDate: until, previousDueDate: from, storeId: reload.storeId || null,
        createdAt: now, updatedAt: now, repairId });
      tx.create(orderRef, { userId, annualFee: 199, reloadAmount: 101, totalCents: 30000,
        renewalType: 'initial', paymentMode: 'initial_package', paymentMethod: 'manual', status: 'fulfilled',
        storeId: reload.storeId || null, balance, createdAt: reload.createdAt, fulfilledAt: now,
        updatedAt: now, historicalRepair: true, repairId, notes: note });
      tx.update(reloadRef, { pointsEquivalent: 101, pointsEquivalentBasis: 'net', annualFeeAmount: 199,
        walletAmount: 101, membershipOrderId: orderRef.id, membershipActivated: true, updatedAt: now, repairId });
      tx.create(auditRef, { timestamp: now, operatorId: 'system_membership_repair',
        operatorName: 'Owner-authorized membership repair', module: 'users', action: 'update',
        targetId: userId, storeId: reload.storeId || '', description: note,
        details: { beforeMembership: user.membership, afterBalance: balance, activeFrom: from, activeUntil: until,
          annualFeeDeducted: 199, reloadId, feeId: feeRef.id, pointsRecordId: pointsRef.id,
          membershipOrderId: orderRef.id, originalReloadPointsEquivalent: reload.pointsEquivalent } });
    }
    return { status: apply ? 'applied' : 'preview', memberId: user.memberId,
      previousBalance: 255, annualFee: 199, balance, activeFrom: from.toDate().toISOString(), activeUntil: until.toDate().toISOString() };
  });
  console.log(JSON.stringify(result));
  const [verifiedUser, verifiedFee, verifiedPoints] = await Promise.all([userRef.get(), feeRef.get(), pointsRef.get()]);
  if (apply && (verifiedUser.data()?.membership?.points !== 56 || verifiedFee.data()?.status !== 'paid' || verifiedPoints.data()?.amount !== 199)) {
    throw new Error('POST_WRITE_VERIFICATION_FAILED');
  }
}
main().catch(() => { console.error('Repair failed; inspect credentials or changed account state before retrying.'); process.exitCode = 1; });
