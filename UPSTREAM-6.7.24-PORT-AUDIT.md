# Upstream v6.7.24 port audit

Audit target: `WhiskeySockets/Baileys@v6.7.24`  
RedxBaileys baseline: `main` at `e0c1ef57471bfb9a3dc54b08525b7a8e3c688edd`.

## Important compatibility decision

RedxBaileys is based on Baileys `7.0.0-rc15`, not the v6 line. Do not replace the v7 implementation with v6 files: v7 has ESM and protocol/API changes, and a wholesale v6 merge would risk breaking callers and WhatsApp sessions.

The exact upstream diff from `v6.7.23` to `v6.7.24` contains seven commits but only release/CI metadata changes (release workflows, changelog, package version metadata, and the bundled fallback WhatsApp revision). It does not contain the broad protocol/performance feature list in the v6.7.24 release announcement; that list describes the v7 work accumulated since RC9.

## Port status in RedxBaileys

The following v7-era capabilities are already present in the current fork (source-level inspection):

- Binary-node child lookup index cached in a `WeakMap`: `src/WABinary/generic-utils.ts`.
- Offline stanza queue uses a head-index FIFO and periodic event-loop yielding: `src/Utils/offline-node-processor.ts`.
- LID↔PN mapping cache, in-flight lookup coalescing, serialized writes, and unchanged-mapping fast path: `src/Signal/lid-mapping.ts`.
- Mutex helpers include keyed mutexes with reference-count cleanup: `src/Utils/make-mutex.ts`.
- Signal key-store caching and transaction mutex cleanup: `src/Utils/auth-utils.ts`.
- Media upload path streams data to temporary files and includes upload retries/host refresh: `src/Utils/messages-media.ts`.
- Message retry/session-recreation manager: `src/Utils/message-retry-manager.ts`.
- App-state, reporting, Trusted Contact token, username/USync and related v7 modules are present in `src/`.

This is a source audit, not a claim that every WhatsApp server flow has been proven in a live account. Full protocol confidence still requires upstream-compatible end-to-end tests.

## v6.7.24-only release metadata

The v6.7.24 bundled revision is `[2, 3000, 1043857760]`. RedxBaileys currently has live WhatsApp service-worker version discovery and a newer bundled fallback `[2, 3000, 1054660005]`. Copying the older v6 fallback would be a downgrade, so it is intentionally not ported.

The upstream publish workflow's npm 11 pin is also already present in RedxBaileys' publish workflow.

## Regression coverage added

`src/__tests__/binary/generic-utils-cache.test.ts` verifies grouped child lookup, stable order, repeated indexed lookup reuse, and safe handling of missing/non-array nodes.
