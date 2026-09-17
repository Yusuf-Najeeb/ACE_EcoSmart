# EcoSmart Screen Specification

The eight screens below cover the generator and recycler flows. Role-specific content appears after sign-in; the app does not create separate screens where a combined screen keeps the pilot simpler.

## 1. Account entry and email verification

**Purpose:** Let a generator or recycler create an account and prove control of their email address.

**Elements, top to bottom, left to right:**

1. EcoSmart logo and page title.
2. Role selector: **I have recyclable waste** (generator) or **I buy recyclable waste** (recycler).
3. Full-name input.
4. Email-address input.
5. Area/neighbourhood input.
6. **Continue** button.
7. email-code input, shown after Continue.
8. **Verify email** button.

**Interactions:**

- Selecting a role stores whether the account is a generator or recycler.
- **Continue** validates the name, email address, and area, then sends a one-time email code and reveals the code input.
- **Verify email** verifies the code. A generator goes to **Screen 3: Check my waste**; a recycler goes to **Screen 2: Recycler verification application**.
- An invalid or expired code shows an error and lets the user request another code.

## 2. Recycler verification application

**Purpose:** Let a recycler submit the evidence required for administrator approval.

**Elements, top to bottom, left to right:**

1. Header with account name and verification status.
2. Recycler/business name and contact-details fields.
3. Government-ID type, ID-number, and document-upload fields.
4. Recycler photo upload.
5. Licence/registration type, number, and document-upload fields.
6. Area/neighbourhood input.
7. **Submit for approval** button.
8. Pending, approved, or rejected status panel with administrator note.

**Interactions:**

- Upload controls attach the selected photo or document to the application.
- **Submit for approval** saves the application as pending and keeps the recycler from receiving listings or making offers.
- A pending status shows that approval is required. Once approved, **Continue to marketplace setup** opens **Screen 4: Recycler marketplace dashboard**.
- A rejected status displays the administrator note and lets the recycler correct and resubmit the application.

## 3. Check my waste

**Purpose:** Let a generator identify supported waste and see recyclability guidance before finding a recycler.

**Elements, top to bottom, left to right:**

1. Header with current area/neighbourhood and account menu.
2. **Scan item** button.
3. **Upload photo** button.
4. Manual material selector: cardboard, PET plastic bottles, aluminium, brass, or glass.
5. Selected-image preview or selected-material summary.
6. Recyclability result and recycling tip.
7. **Find recyclers** button, enabled after a supported material is selected.
8. **Not supported in this pilot** message and **Choose another material** button, shown when applicable.

**Interactions:**

- **Scan item** or **Upload photo** submits an image for intake; a low-confidence result asks the generator to choose a material manually.
- The material selector saves the generator's final selection and displays the appropriate recyclability guidance and tip.
- **Find recyclers** opens **Screen 5: Recycler matches and listing** using the selected material and area.
- **Choose another material** clears the unsupported result and returns the generator to the intake controls.

## 4. Recycler marketplace dashboard

**Purpose:** Let an approved recycler configure accepted materials, non-binding estimates, availability, and view matching requests.

**Elements, top to bottom, left to right:**

1. Header with recycler name, verification badge, and account menu.
2. Availability switch: **Available** or **Unavailable**.
3. Accepted-material list with checkbox for each pilot material.
4. For each accepted material: estimated-price input in naira, unit selector (per kilogram, per item, or per bag), and estimate-not-final label.
5. **Save marketplace settings** button.
6. Incoming request list, showing material, location, quantity if known, arrangement preference, and status.
7. **View request** button on each incoming request.
8. Link to transaction records.

**Interactions:**

- Changing availability immediately includes or excludes the recycler from generator matches.
- Material checkboxes, price inputs, and unit selectors update the recycler's buying settings; **Save marketplace settings** publishes them as estimates, never as final offers.
- **View request** opens **Screen 6: Listing and handover** for that request.
- The transaction-records link opens **Screen 8: Records and administration** in recycler view.

## 5. Recycler matches and listing

**Purpose:** Let a generator compare matching verified recyclers and send one selected recycler a listing.

**Elements, top to bottom, left to right:**

1. Header with back button and selected material.
2. Recyclability summary and reminder that prices are estimates, not final offers.
3. Matching-recycler cards, each showing recycler name, area/neighbourhood, accepted material, estimated price, unit, availability, and **Select** button.
4. Listing form for the selected recycler: description, photo upload, quantity and unit if known, location, and pickup/drop-off preference.
5. **Send listing** button.
6. Empty-state message when no verified available recycler matches.

**Interactions:**

- **Select** chooses one recycler and opens or focuses the listing form; it does not send the listing to every recycler.
- Photo upload attaches an image to the listing.
- **Send listing** validates the form, sends it to the selected recycler only, and opens **Screen 6: Listing and handover** in generator view with status **Sent to recycler**.
- If the selected recycler later declines, this screen reopens with other matching recyclers; the generator can select and send to another recycler.

## 6. Listing and handover

**Purpose:** Let the matched generator and recycler review a listing, respond, share approved contact details, and agree pickup or drop-off.

**Elements, top to bottom, left to right:**

1. Header with listing status and transaction ID.
2. Material, photo, description, quantity, location, and preferred-arrangement summary.
3. Recycler estimated price and unit, labelled **Estimate — not final offer**.
4. Recycler controls, shown only to the selected recycler: **Accept**, **Decline**, decline-reason input, and arrangement selector/note.
5. Shared contact-details panel, shown only after acceptance.
6. Optional in-app chat thread and message input for an active accepted listing.
7. Optional **Start call** button for an active accepted listing.
8. **Handover completed / continue to inspection** button, shown to the recycler after the direct exchange.

**Interactions:**

- **Accept** records acceptance, saves the agreed pickup/drop-off arrangement, reveals approved contact details to both parties, and enables chat/call.
- **Decline** records the response and returns the generator to **Screen 5: Recycler matches and listing** to choose another match; it does not broadcast the listing.
- The chat input sends a message only to the matched party for this active listing. **Start call** sends the matched party a call invitation.
- **Handover completed / continue to inspection** opens **Screen 7: Inspection, final offer, and decision** in recycler mode. Pickup/drop-off itself happens outside EcoSmart.

## 7. Inspection, final offer, and decision

**Purpose:** Let the recycler record inspection and fund a final offer, then let the generator accept or reject it within 24 hours.

**Elements, top to bottom, left to right:**

1. Header with listing status, transaction ID, and expiry countdown when an offer is active.
2. Inspection fields, shown to recycler: actual weight/quantity, unit, and optional inspection note.
3. Final-amount input in naira, shown to recycler.
4. Funding status panel and **Fund and send final offer** button, shown to recycler.
5. Actual weight/quantity and funded final-offer summary, shown to generator after funding.
6. **Accept final offer** and **Reject final offer** buttons, shown to generator while the 24-hour offer is active.
7. Rejection-reason input, shown after Reject.
8. Final result panel: completed payout, rejected, expired, or payment-failed status.

**Interactions:**

- **Fund and send final offer** validates inspection and amount, funds the exact amount through the wallet/payment provider, then sends the offer. It cannot send an unfunded offer.
- **Accept final offer** releases the full funded amount to the generator. No commission is deducted during the pilot. Both users go to **Screen 8: Records and administration** in their own record view.
- **Reject final offer** records the rejection and makes no payment; both users can view the result in **Screen 8**.
- If the generator does nothing, the app expires the offer after 24 hours, makes no payment, and shows the expired result.

## 8. Records and administration

**Purpose:** Let generators and recyclers view time-stamped transaction records; let administrators manage recyclers, materials, and marketplace records.

**Elements, top to bottom, left to right:**

1. Header with role-specific title and account menu.
2. Transaction-record list for generators/recyclers, with status and date filters.
3. Selected record timeline: material intake/selection, estimate shown, listing, recycler response, arrangement, inspection, final offer, generator decision, and payment outcome.
4. Payment reference and payout status, when applicable.
5. Administrator-only recycler-approval queue with **Approve** and **Reject** controls.
6. Administrator-only supported-material catalogue with add, update, and deactivate controls.
7. Administrator-only marketplace-record search and detail panel.

**Interactions:**

- Selecting a record shows its complete time-stamped history and payment outcome.
- **Approve** enables the recycler to use **Screen 4: Recycler marketplace dashboard**; **Reject** updates the recycler's verification status and stores an administrator note.
- Material catalogue controls change which pilot materials appear in **Screen 3** and **Screen 4**.
- Marketplace-record search opens the selected record's timeline for administration. It does not add ownership decisions, dispute resolution, transport fulfilment, ratings, or commission handling.
