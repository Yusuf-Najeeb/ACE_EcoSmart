# EcoSmart dashboard implementation review

Date: 16 September 2026

Scope: implementation study of Admin, Recycler, and Generator dashboards. No application code or existing database records changed. Reviewed source, requirements, and tests; ran the existing suite and isolated API probes. This is not a visual/browser acceptance report: mobile rendering, keyboard interaction, real email delivery, camera hardware, and multi-browser behavior remain unverified.

## Current implementation

The application is a dependency-free Node HTTP server with SQLite persistence and a vanilla JavaScript frontend. `public/index.html` is the served UI; the root `index.html` is not the application entry point. `public/app.js` switches visible screens and maintains client state. `server.js` contains authentication, marketplace, wallet, and admin endpoints; `storage.js` owns schema and seed materials. Email OTP uses the provider in `email.js`.

| Role | Implemented flow |
| --- | --- |
| Admin | Sign in → recycler applications → inspect documents → approve/reject → manage material catalogue → search marketplace records and audit history |
| Recycler | Register/sign in → submit verification documents → await review → manage accepted materials/prices/availability → receive requests → accept/decline → coordinate handover/chat/call status → record inspection and funded offer → inspect wallet/history |
| Generator | Register/sign in → select material or capture/upload image → guidance → recycler matches → send listing → coordinate handover → accept/reject final offer → wallet/cash-out/history |

The UI contains these flows, but some apparent capabilities are simulations or incomplete integrations.

## Verified findings, in priority order

### 1. Critical: admin endpoints do not enforce administrator authorization

Locations: `server.js:1239`, `server.js:1274`, `server.js:1294`, `server.js:1325`.

An anonymous same-origin POST to `/api/admin/applications` returns applications including ID-document data. Anonymous callers can modify the material catalogue through `/api/admin/materials/save`. The review endpoint checks only whether a user is signed in: a recycler can approve their own application and become active. The records endpoint similarly lacks a role guard. Hiding admin navigation does not protect these APIs.

Isolated reproduction: anonymous application request returned 200 and ID-document content; anonymous material save returned 200; recycler self-approval returned 200 with active account status.

Fix direction: require an authenticated administrator at every admin endpoint before reading or writing data. Add denial tests for anonymous, generator, and recycler callers. Existing admin tests frequently register a recycler as their supposed admin, so they currently endorse the missing guard.

### 2. Critical for real-money use: wallet success is simulated

Locations: `server.js:438`, `server.js:470`, `server.js:496`, `server.js:931`; `public/app.js:3090`.

Top-up directly credits the requested amount without a payment-provider confirmation. Withdrawal directly subtracts balance and records success without transferring funds. Offer creation automatically credits any wallet shortfall and marks the offer funded. Bank linking stores entered details; the browser displays verification after ten digits and substitutes the signed-in user's name without a bank lookup.

Isolated reproduction: a recycler starting with zero balance successfully submitted a 1,000 NGN offer, creating 1,000 NGN of locked escrow without funding.

Fix direction: clearly separate demo balances from real money; require verified funding before escrow, real account resolution before claiming verification, and provider-confirmed payout states before claiming money was sent. Do not represent the current implementation as bank settlement.

### 3. High: viewing an expired offer can strand escrow

Location: `server.js:1138` (compare with the wallet updates in the offer-decision expiry path near `server.js:1003`).

The listing-details expiry branch marks the offer expired and funding returned, writes a refund payment and audit event, but never adjusts the recycler's available or locked wallet balances. Once marked expired, later reads do not retry that branch. Expiry also depends on interaction rather than a periodic settlement process.

Isolated reproduction: create a 1,000 NGN funded offer, advance the clock beyond 24 hours, then request `/api/listings/details`. Listing becomes expired while the recycler still has 0 available and 1,000 locked.

Fix direction: share one atomic, idempotent expiry/refund operation across all triggers; test wallet balances and ledger entries, not just offer status. Provide a reliable expiry trigger even if nobody opens the listing.

### 4. Medium: matching does not enforce the specified area restriction

Locations: `server.js:251` and `server.js:633`; `public/app.js:613`.

Both match implementations return every eligible recycler and only attach `isAreaMatch`; neither filters by area. The UI renders all matches without using that flag, while its wording promises recyclers in the generator's area. Prices are ordered numerically across different units, which also makes the ordering a poor comparison.

Isolated reproduction: an Ikeja generator received an Abuja recycler with `isAreaMatch: false` and could create a listing to that recycler.

Fix direction: define explicit service areas and enforce the intended matching rule. If wider-area discovery is deliberate, label it clearly and distinguish price units when sorting.

### 5. High capability gap: voice calls have no audio transport

Locations: `public/app.js:1020–1179`, `server.js:1588–1757`.

The UI and APIs implement ringing, answering, ending, and timers. There is no audio capture or peer/media transport; mute toggles a boolean and button appearance only. The only `getUserMedia` call captures camera video with audio disabled.

Evidence: source inspection. Audio behavior was not browser-tested.

Fix direction: implement actual audio transport and permission/error handling, or remove the voice-call promise until it exists. Tests currently validate call-state bookkeeping, not audible communication.

### 6. Medium capability gap: photo analysis reads filenames, not images

Location: `server.js:572`.

Classification uses regexes against filename and optional text hints. Image content is not analyzed. A generic camera filename falls back to manual selection; a misleading filename can produce a high-confidence material result.

Isolated reproduction: sending `fileName: 'glass.jpg'` without an image returns detected glass with high confidence.

Fix direction: make manual confirmation explicit and describe the current feature honestly, or integrate image analysis with uncertainty handling.

## Additional code findings to validate in the browser

- **Recycler approval does not update the visible application screen automatically.** The four-second polling loop (`public/app.js:3218`) updates wallet and request data but does not update `currentUser`, `recyclerApp`, or route on account-status changes. A pending recycler may remain on the pending screen until refresh; rejected users may not immediately see their review note.
- **Unescaped data enters generated HTML.** Matching cards interpolate business names and areas directly (`public/app.js:635`); intake history and some other cards also use raw values. This permits markup injection. The CSP restricts inline script execution, so this review does not claim a demonstrated script-execution exploit. Use text nodes or consistent escaping for user-controlled fields.
- **Navigation has no URL/history model.** Screen switching does not integrate with browser history. Refresh returns users through the default role route instead of restoring the current record or task.
- **Wallet transaction state uses inconsistent response names.** Top-up and withdrawal handlers read `res.transactions`, whereas APIs return `walletTransactions`; the background poll eventually refreshes it.
- **Session expiry is not handled by polling.** A successful state response with `user: null` is ignored, leaving a stale signed-in view until a later action or reload.
- **Documentation is obsolete.** README and VERIFICATION still describe a registration-only SMS release with no returning login. Current implementation uses email OTP and includes the three dashboard flows.

## UI upgrade priorities

These are design recommendations from the UI implementation, not claims of visually reproduced defects.

| Dashboard | Recommended upgrade |
| --- | --- |
| Admin | Lead with pending reviews and queue age; provide document previews, clear decision notes, and visible confirmation of the reviewed application's new status. Add pagination to records rather than silently capping results at 100. |
| Recycler | Prioritize incoming requests and offers awaiting a generator decision; make pricing/settings secondary. Show approval changes immediately. Explain available versus locked funds and how expiry returns them. |
| Generator | Use one prominent next action at each transaction stage; distinguish manual identification from image analysis; show recycler service area and explicit price unit; emphasize offer deadline and accept/reject consequences. |
| Shared | Replace visible `SCREEN`/`FR` labels with task names. Add stable navigation/deep links, recoverable loading/error states, and accessible dialogs with Escape, focus containment, and focus restoration. Verify mobile layouts and keyboard traversal in a browser. |

## Validation and next work

- Existing `npm test`: **61 passed, 0 failed**. The initial sandbox attempt failed with subprocess EPERM; the authorized rerun completed successfully.
- `node review/dashboard-probes.mjs`: reproduces anonymous admin access and catalogue mutation, self-approval, out-of-area matching, automatic escrow funding, stranded expiry balance, and filename-only detection. Uses an in-memory database and a local provider double; sends no external messages and does not open the existing database.
- Tests named `user-records-browser` are HTTP/API tests, not real browser automation. Passing tests do not establish browser or payment-provider correctness.
- Recommended sequence: admin authorization → wallet/demo boundary and escrow correctness → role-state refresh and capability gaps → dashboard navigation/UI polish → real browser acceptance across all roles and mobile widths.

No visual health score is assigned because no browser pass was performed. Application fixes are not included in this study.
