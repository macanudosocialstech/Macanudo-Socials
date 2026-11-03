# Admin visit pagination activation

The new admin page is deliberately disabled unless the build environment sets
`VITE_ADMIN_VISIT_PAGINATION_READY=true`. Both tabs show a bilingual migration
alert rather than an empty history or an unlimited legacy fallback. This is a
build-time switch, not an authorization mechanism. Additionally every page reads
`_adminVisitPaginationMeta/default` from the server and requires `ready: true`
and `schemaVersion: 1`. The migration publishes this marker only after a clean
verification. Existing Firestore rules
remain the security boundary. Store-scoped callers must have a nonempty storeId.

## Dry run

Use authorized Application Default Credentials or FIREBASE_SERVICE_ACCOUNT.
Do not print credentials or commit audit output.

```powershell
node scripts/backfill-admin-visit-pagination.cjs --project EXACT_PROJECT_ID
node scripts/backfill-admin-visit-pagination.cjs --project EXACT_PROJECT_ID --mapping mapping.json --plan
```

Dry run never writes. The script scans in 200-document chunks,
checks every session, grouped redemption document, and user with referral rewards,
and optionally emits patch proposals. Dry run does not publish readiness. `dataReady`
only describes data, not index or writer readiness. Mapping format:
`{"sessions":{"session-id":"verified-store-id"},"users":{"user-id":"verified-store-id"}}`.
The owner must verify mappings. Current user store assignments must never be used
to guess a historical session's store. Missing/invalid timestamps, statuses,
orphan sessions, and conflicting stores require explicit resolution.

## Activation guard

1. Keep the flag absent/false. Review dry-run proposals and unresolved records.
2. Review mappings and approve running the apply command below. Apply requires
   the explicit project and deployed-trigger acknowledgement. It refuses unresolved
   data, locks readiness by run ID, patches mappings with transactional rereads,
   calls the trusted metadata synchronizer for each grouped document, audits again,
   and publishes readiness only on success. Financial fields and arrays stay intact.
   Interrupted runs remain unready; use `--resume-run EXACT_RUN_ID` after reviewing
   the recorded run to recover a crashed lock. Failures clear the lock and leave
   readiness false. A new run never replaces another active run.
3. Before activation, cover ALL writers (managed lounge backend, imports,
   historical repair scripts, old clients, and deletes/status changes) with a
   trusted synchronous projection or a reviewed synchronization mechanism.
   `adminStatuses` must equal the unique item statuses, treating missing item
   status as completed; storeId must match the linked historical session.
   Register `syncRedemptionAdminMetadata(db, sessionId)` from
   `firebase-functions/redemptionAdminMetadata.cjs` as an onDocumentWritten trigger
   on redemptionRecords/{sessionId}, retry enabled. It rereads source and linked
   session in a transaction, changes metadata only, and is idempotent on its own
   updates. Member writes intentionally omit metadata to preserve current rules.
   Old clients are covered by the trigger. Admin create/confirm also maintain
   metadata immediately. A projection failure clears readiness. Trigger delivery
   is eventual: new pending work from members/old clients can briefly be absent
   until the trigger runs. This latency is an explicit activation tradeoff.
4. Coordinate rules and indexes with the Dashboard owner, verify them in an
   emulator/staging environment, rerun the full audit until zero patches and
   zero unresolved records, then separately authorize activation/deployment.
5. Set the flag only after all above checks pass. Clear it if writer coverage
   or data integrity regresses. Never use an unbounded fallback to activate.

After separate authorization (not executed as part of this implementation):

```powershell
node scripts/backfill-admin-visit-pagination.cjs --project EXACT_PROJECT_ID --mapping mapping.json --apply --trigger-deployed
```

Shared registration handoff: add `ADMIN_VISIT_PAGINATION_META` with value
`_adminVisitPaginationMeta` to GLOBAL_COLLECTIONS. Permit admin get on its
`default` document and deny client list/write. The Dashboard agent owns these
shared edits, the trigger export in index.cjs, and the indexes below.

## Index handoff (do not edit shared files here)

All indexes use queryScope COLLECTION. Visit queries order by checkInAt DESC
and __name__ DESC; Firestore's implicit __name__ direction follows checkInAt.
Use these fields for collectionGroup visitSessions (ASC fields before DESC):

- status ASC, checkInAt DESC
- storeId ASC, status ASC, checkInAt DESC
- userId ASC, status ASC, checkInAt DESC
- storeId ASC, userId ASC, status ASC, checkInAt DESC

For redemptionRecords (implicit __name__ ASC):

- adminStatuses CONTAINS (single-field array index, normally automatic)
- storeId ASC, adminStatuses CONTAINS (composite)

Scoped referral queries use users.storeId equality and __name__ ASC; default
single-field indexing suffices. Confirm no exemptions disable it. Date ranges
apply to visit checkInAt and reuse these indexes. No rules changes were made.

## UI and consistency

Visits use 20/50/100 source visits per page plus one lookahead; pending visits
are exhausted before completed/expired history. Exact user-ID, status, date,
store, and size changes restart cursors. Rebate display rows do not inflate visit
counts. Redemption pages read at most size+1 source documents, not item rows;
arrays stay grouped in storage. Pending and completed phases are separate so a
mixed group cannot put completed items ahead of later pending items. Referral
milestones remain a third source phase, or can be selected directly by type.
Redemption keyword search and item totals apply ONLY to the current database
page. Empty source/filtered pages can still have a Next button. Neither tab
claims a global total. Ordering within redemption phases is document ID, with
time sorting within the displayed page only. Refresh restarts at page one;
previous pages use a ten-page cache, so refresh after concurrent changes.

Reports retain their existing full-export compatibility API. Its store-scoped
path now queries storeId directly and uses the migration guard; it no longer
joins against all visit sessions. Non-admin financial history/eligibility APIs
retain their existing behavior, including their legacy fallback.
