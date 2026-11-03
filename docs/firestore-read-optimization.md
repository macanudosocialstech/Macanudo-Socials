# Visit read optimization rollout

## Boundaries

The optimization changes read models, not wallets, visit charges, inventory
settlement, or redemption eligibility rules. Production deployment and backfills
are separate, explicit operations. Do not run maintenance commands from app startup.

Browser `Observed reads` measure returned documents (listener changes for query
listeners), not a Firebase invoice. Empty queries still count as requests. Cache
reads are separate. Operation labels are allowlisted, never user IDs or filters.

## Read models

- Dashboard check-in trends use daily/monthly/yearly buckets, not raw history.
- Dashboard occupancy counts distinct people whose visits overlap a time bucket;
  it is not the number of check-ins. Open visits remain open until settlement.
  Its weekly view is the current Monday-Sunday calendar week, not a rolling
  seven-day window. Both series use the same UTC+08 day boundaries. Future
  weekdays have no observed activity. The `weekStart` marker rejects older
  rolling-window occupancy snapshots until the deployed worker refreshes them.
- The second occupancy-chart line sums cigar quantities by the original
  `redeemedAt` hour/day (UTC+08 calendar days). Pending and completed claims,
  including Day Pass cigars, count once. Referral rewards and cancelled/rejected
  items do not count. Confirmation does not move or duplicate a pending claim.
- Member completed hours include completed, non-Day-Pass visits across history.
  They do not replace `membership.totalVisitHours`, which has a different legacy
  and realtime-credit meaning. Expired visits retain the previous exclusion.
- Redemption occupancy continues to include pending and completed quantities;
  cancellation releases occupancy and completion must not add it twice.
- Admin history uses cursor pagination with pending visits first. Pagination
  does not promise a snapshot across concurrent check-outs: refresh resets cursors.
- Redemption documents contain arrays. A document page can contain more item rows
  than its document limit. Do not label that limit as an exact item total.

Projection triggers re-read current source documents in transactions and compare
private checkpoints. Duplicate, reordered and retried events converge; edits,
deletions and changes of ownership must remove the old contribution first.
Projection updates are asynchronous, not transactionally simultaneous with billing.

## Deployment order

1. Run focused tests, the production build, and rule tests against an emulator.
2. Review and deploy the new private projection rules and composite indexes.
3. Deploy the Firebase projection triggers and occupancy scheduler. Deploying
   Netlify alone does not deploy these Firebase functions.
4. Preview each maintenance script using explicit project selection and trusted
   server credentials. Never print credentials or put them in a browser build.
5. Resolve unattributed or malformed legacy documents. Do not invent a store or
   member owner simply to make migration pass.
6. Apply backfills only after confirming the associated triggers are deployed.
   Wait for successful readiness publication and inspect projection comparisons.
7. Enable frontend readiness flags only after indexes and metadata are ready.
8. Deploy the web build, test each authorized role, and compare operation-level
   reads under equivalent usage. Keep source data and checkpoints for rollback.

Preview member hours:

```powershell
node scripts/backfill-visit-member-stats.cjs --project macanudosocial
```

Preview Dashboard statistics:

```powershell
node scripts/backfill-dashboard-visit-stats.cjs --project=macanudosocial
```

Both are dry-runs unless `--apply` is supplied. Apply additionally requires
`--trigger-deployed`, an operator assertion, not an automatic deployment check.
The admin-pagination migration and its readiness flag must also be completed
before enabling paginated admin queries; see the script and `env.example`.

The cigar curve has an independent readiness gate and these additional Firebase
triggers: `syncDashboardRedemptionStats` and `syncDashboardRedemptionVisitScope`.
Deploy them and the private redemption-summary rules before previewing:

```powershell
node scripts/backfill-dashboard-redemption-stats.cjs --project=macanudosocial
```

Apply requires `--apply --trigger-deployed`. To recover an abandoned run, first
confirm that its process is stopped, then use `--restart-incomplete`. The tool
repairs checkpoint-derived counter drift before syncing edited/deleted sources.
The curve remains unavailable, not zero, until this bootstrap succeeds.
Dashboard occupancy/trend reads are bounded at 35 documents; initialized cigar
statistics add 33 documents per refresh (24 hours, seven days, and two readiness
reads). No browser query scans raw redemption history for this curve.

## Failure and rollback

- Missing/unready/invalid summaries are not an authoritative zero.
- Missing indexes must fail visibly; never replace an indexed page query with an
  unrestricted full scan.
- Stop rollout if totals differ from source semantics, store isolation fails,
  billing changes, or stale projections appear complete.
- Disable the affected new read path or roll back the web release. Do not delete
  historical transactions or projection checkpoints as a rollback technique.
- Fix the underlying error and rerun a preview before rebuilding projections.
  A killed backfill may require operator review of its readiness/lock document;
  do not clear a lock while its process may still be running.
- A rollback must not re-enable broad history polling for every open browser.

## Acceptance checks

- Opening Dashboard does not query all raw `visitSessions` documents.
- Ordinary history navigation reads at most the requested page plus lookahead
  per phase; returning to a cached page does not repeat the same query.
- Loading redemption management does not scan store visit history for ownership.
- Opening the visit tab does not eagerly load redemption history.
- Member history is not repeatedly scanned every minute for completed hours.
- Check-out affordability, Day Pass, negative-balance settlement and inventory
  behavior remain covered by the existing financial regression tests.
- Projection tests cover duplicate events, edits, deletion, owner/store changes,
  invalid sources, cross-day occupancy and concurrent migration fences.
- Browser metrics distinguish requests, returned documents, cache reads,
  listener initial/change events and fixed operation names without double totals.

Root web changes do not automatically optimize Expo or Flutter clients. Their
separate home repositories must be assessed before claiming a fleet-wide reduction.
