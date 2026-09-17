# EcoSmart Open Marketplace Data Structure

This is the plain list of information EcoSmart must remember. Every record should have a unique ID, a creation date/time, and a last-updated date/time unless a field below says otherwise.

## 1. User account

One account for a waste generator, recycler, or EcoSmart administrator.

- User ID
- Role: `generator`, `recycler`, or `administrator`
- Full name
- Email address
- Email-verification status: `unverified` or `verified`
- Area/neighbourhood
- Approved contact details that may be shown only to a matched party
- Account status: `active`, `pending recycler approval`, `rejected`, or `suspended`

## 2. Email verification

A one-time email verification attempt for an account email address.

- Email-verification ID
- User ID or pending registration ID
- Email address
- One-time email code reference
- Status: `sent`, `verified`, `expired`, or `failed`
- Code sent date/time
- Code verified date/time, if verified

## 3. Recycler verification application

The information a recycler submits before receiving listings or making offers.

- Recycler-verification ID
- Recycler user ID
- Recycler name and phone number
- Government ID type, number, and document/file reference
- Recycler photo file reference
- Recycler licence or registration type, number, and document/file reference
- Submitted area/neighbourhood
- Approval status: `pending`, `approved`, or `rejected`
- Reviewing administrator user ID
- Review date/time
- Approval or rejection note

## 4. Supported material catalogue

The administrator-managed list of materials that EcoSmart supports in this pilot.

- Material ID
- Material name: cardboard, PET plastic bottles, aluminium, brass, or glass
- Active/inactive status
- Recyclable status
- Recycling guidance or tip
- Catalogue change date/time
- Administrator user ID who last changed it

## 5. Recycler material and buying estimate

One recycler's buying settings for one supported material.

- Recycler-material-setting ID
- Recycler user ID
- Material ID
- Accepted/not accepted status
- Estimated buying price in naira
- Price unit: `per kilogram`, `per item`, or `per bag`
- Label stating that the price is an estimate, not a final offer
- Current availability: `available` or `unavailable`
- Recycler area/neighbourhood
- Effective-from date/time
- Ended date/time, if changed or removed

Keeping prior settings with an end date provides the dated estimate history that may be shown in a later build.

## 6. Material intake attempt

Each time a generator checks an item before creating a listing.

- Material-intake ID
- Generator user ID
- Intake method: `scan`, `photo upload`, or `manual selection`
- Uploaded image/file reference, if provided
- System-suggested material, if any
- Confidence result: `confident`, `uncertain`, or `not supported`
- Generator's final selected material ID, if one is selected
- Outcome: `continued to matching` or `not supported in this pilot`
- Guidance/tip version shown to the generator

## 7. Media file

A reference to an uploaded recycler photo, government-ID file, licence/registration file, material-intake image, or listing photo.

- Media-file ID
- Owner user ID
- Linked record type and linked record ID
- Media type: `photo` or `document`
- Storage reference or file URL
- Original file name
- Upload date/time

## 8. Recycler match result

A saved snapshot of recyclers shown to a generator for a selected material. This keeps a record of the estimate and unit seen at the time of matching.

- Match-result ID
- Material-intake ID or listing ID
- Generator user ID
- Recycler user ID
- Generator and recycler area/neighbourhood used for the match
- Selected material ID
- Recycler availability at match time
- Estimated price and price unit shown at match time
- Match date/time
- Match status: `shown`, `selected`, or `not selected`

## 9. Listing

A generator's request sent to one selected recycler. EcoSmart does not automatically send a listing to every recycler.

- Listing ID
- Generator user ID
- Selected recycler user ID
- Material ID
- Linked material-intake ID, if one exists
- Description
- Listing photo/media-file references, if provided
- Declared quantity, if known
- Quantity unit, if known
- Generator location or pickup/drop-off location
- Generator area/neighbourhood
- Preferred arrangement: `pickup` or `drop-off`
- Status: `draft`, `sent to recycler`, `accepted`, `declined`, `handover arranged`, `inspected`, `funded final offer`, `completed`, `rejected`, or `expired`
- Sent date/time

## 10. Recycler response and handover arrangement

The recycler's decision on a selected listing and the agreed practical exchange method.

- Listing-response ID
- Listing ID
- Recycler user ID
- Response: `accepted` or `declined`
- Decline reason, if supplied
- Response date/time
- Agreed arrangement: `pickup` or `drop-off`, if accepted
- Arrangement note, such as meeting details agreed by the parties
- Contact-details-shared date/time, if accepted

## 11. Inspection record

The recycler's inspection of a material after direct pickup or drop-off.

- Inspection ID
- Listing ID
- Recycler user ID
- Inspection date/time
- Actual weight or quantity
- Actual weight/quantity unit
- Inspection note, if supplied

## 12. Final offer

The recycler's final offer after inspection. It must be funded before it can be sent to the generator.

- Final-offer ID
- Listing ID
- Recycler user ID
- Generator user ID
- Linked inspection ID
- Final amount in naira
- Currency: `NGN`
- Funding status: `pending`, `funded`, `failed`, `released`, or `returned/unavailable`
- Offer status: `draft`, `funded and sent`, `accepted`, `rejected`, or `expired`
- Sent date/time
- Expiry date/time: 24 hours after the offer is sent
- Generator decision: `pending`, `accepted`, `rejected`, or `expired`
- Generator decision date/time
- Rejection reason, if the generator provides one

## 13. Wallet payment record

Every wallet/payment-provider movement connected to a final offer.

- Payment ID
- Final-offer ID
- Payer user ID: recycler
- Payee user ID: generator, when released
- Payment type: `recycler funding`, `generator payout`, or `funding return/unavailable`
- Amount in naira
- Currency: `NGN`
- Commission amount: always `0` during the free pilot
- Payment-provider name
- Payment-provider reference
- Payment status: `started`, `successful`, `failed`, `reversed`, or `not released`
- Initiated date/time
- Confirmed date/time, if completed
- Failure or reversal reason, if applicable

## 14. Transaction event history

The time-stamped record of important actions across a listing and its final offer.

- Transaction-event ID
- Listing ID
- Final-offer ID, if relevant
- Event type: account verified, material checked, listing created, listing sent, recycler accepted, recycler declined, handover arranged, inspection recorded, offer funded, offer sent, offer accepted, offer rejected, offer expired, payout released, or payout failed
- Actor user ID or `system`
- Previous listing/offer status
- New listing/offer status
- Related record ID, such as payment, inspection, response, or match result
- Event date/time
- Event note

## 15. In-app chat message (Should have)

A message exchanged only by the matched generator and recycler for an active listing.

- Message ID
- Listing ID
- Sender user ID
- Recipient user ID
- Message text
- Sent date/time
- Delivery/read status

## 16. In-app call session (Could have)

A record of a call invitation or call between the matched generator and recycler for an active listing.

- Call-session ID
- Listing ID
- Initiating user ID
- Invited user ID
- Call status: `invited`, `accepted`, `declined`, `ended`, or `failed`
- Started date/time
- Ended date/time

## 17. Administrator action

An administrator's change to a recycler profile, the supported-material catalogue, or marketplace record.

- Administrator-action ID
- Administrator user ID
- Action type: `approve recycler`, `reject recycler`, `update recycler profile`, `add material`, `update material`, `deactivate material`, or `view/manage marketplace record`
- Affected record type and ID
- Action note
- Action date/time

## 18. Pilot measurement record

A record used to assess the pilot from the activity EcoSmart already stores.

- Measurement ID
- Measurement type: generator account, verified recycler, material-intake attempt, supported-material listing, recycler accept/decline, handover arrangement, final offer, generator acceptance, rejected/expired offer, successful wallet payout, or listing-to-offer duration
- Related user, listing, final-offer, or payment ID
- Measured value, where needed (for example, duration in hours)
- Recorded date/time

## Important relationships

- One user account can be a generator, recycler, or administrator; a recycler also has one verification application and many recycler-material settings.
- One supported material can be accepted by many recyclers and used in many intake attempts and listings.
- One material-intake attempt can lead to many shown match results and one listing.
- One listing belongs to one generator and one selected recycler. It has one recycler response, one handover arrangement, zero or one inspection record, zero or one final offer, and many event records.
- One final offer has one inspection record, many payment records, and one generator decision.
- Chat messages and call sessions belong only to an active listing shared by its matched generator and recycler.

## Deliberately not stored for this pilot

- A commission calculation beyond the required zero commission during the free pilot.
- Precise map coordinates or distance-based matching; matching uses area/neighbourhood.
- A promise that a scan correctly identifies every item; the intake record preserves the manual-selection fallback instead.
- Waste transport, storage, ownership transfer, delivery fulfilment, fraud adjudication, insurance, litigation, ratings, or general advertising records, because EcoSmart does not provide those services in this build.
