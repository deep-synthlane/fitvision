# Data handling, retention and deletion

This describes what the code does today. Legal review (GDPR, DPDP Act 2023 for India, CCPA, and so
on) has **not** been done and is required before a public launch. See `RELEASE_CHECKLIST.md`.

## What is stored

| Data | Where | Notes |
| --- | --- | --- |
| Account (name, email, bcrypt password hash) | PostgreSQL | |
| Profile & measurements | PostgreSQL | Includes raw scan estimates for audit. |
| Body-scan photos | Object storage `scans/<user>/` | Re-encoded on upload: metadata (EXIF, GPS) removed. |
| Avatar model | Object storage `avatars/<user>/` | Parametric mannequin, not built from photos. |
| Clothing images | Object storage `products/<user>/` | Re-encoded, metadata removed. |
| Try-on photos & results | Object storage `tryon-photos/<user>/`, `tryons/<user>/` | Re-encoded. Includes server-made avatar renders (`source = avatar_render`). Each result records its person source (uploaded, camera, saved photo or avatar render) and, for avatars, the avatar id and model version. |
| Size recommendations & fit feedback | PostgreSQL | Feedback snapshots brand/category/engine version. |
| Usage analytics | PostgreSQL `analytics_events` | Pseudonym = HMAC(user id); allow-listed properties only (category, source, confidence, status, engine version, provider source, fit rating, chart quality). No names, emails, photos, measurements or URLs. |
| Logs | stdout → your log platform | Request ids, user ids, routes, status codes. No bodies, cookies, tokens or passwords. |

All images are private. They are served only to their owner through authenticated API routes
(`Cache-Control: private, no-store`); there are no public or signed bucket URLs.

## Deletion

**Per category** (Privacy page → "Delete your data", `DELETE /api/account/data/:kind`):

| Kind | Deletes |
| --- | --- |
| scans | Scan records and photos. Measurements are kept (unlinked from the scan). |
| measurements | Measurements, plus avatars (and their try-on renders) and size recommendations built from them. |
| avatar | Avatar records, model files and avatar renders made for try-on. |
| try-on-photos | Try-on photos (files deleted; rows marked deleted so past results stay readable without the photo). |
| try-ons | Try-on results, their images and saved looks. |
| products | Clothing, images, try-ons on them, size recommendations and fit feedback. |
| saved-looks | Saved looks only. |

**Whole account** (`DELETE /api/account`, password required, 5 attempts per 15 minutes):

1. Cancels any try-on still running at an external provider.
2. Deletes the user row; every user-owned table cascades (profile, measurements, scans, avatars,
   products, images, try-ons, saved looks, collections, recommendations, feedback).
3. Deletes the user's analytics events (pseudonym recomputed from the user id).
4. Deletes every storage prefix for the user.
5. Clears the session cookie. Other sessions stop working immediately, because the user row they
   point at is gone.

Deletion is immediate and cannot be undone. It is covered by API tests and the E2E deletion test.

## Retention

| Item | Retention |
| --- | --- |
| Account data | Until the user deletes it. |
| Failed or cancelled try-on attempts | Purged after `TRYON_FAILED_RETENTION_DAYS` (default 7). |
| Database backups | 30 days (recommended, `DEPLOYMENT.md` §7). A deleted account can still be in a backup until it expires; deletions are re-applied after any restore. |
| Bucket non-current versions | 30 days, if versioning is enabled (`DEPLOYMENT.md` §6). |
| Logs | Set by the operator; 30 days recommended. |
| Feedback exports | Offline files; delete after analysis. Each export uses a fresh random salt, so files can't be linked to each other or to analytics. |

## Third parties

- **Try-on provider** (only when a real provider is enabled): the user's try-on photo and the
  garment image are sent to the provider after an explicit confirmation each time. The provider
  keeps them according to its own terms. Review those terms and record them here before enabling a
  provider in production.
- **MediaPipe** (body scan, photo checks): the library and model are downloaded from
  cdn.jsdelivr.net and storage.googleapis.com, and **photos are analysed in the browser** and are not
  sent there. Those hosts still see the user's IP address when the files load. Self-hosting the
  WASM and model files would remove that (`SECURITY_REVIEW.md` R4).
- **Product import:** the server fetches the public product page once, without the user's cookies.
