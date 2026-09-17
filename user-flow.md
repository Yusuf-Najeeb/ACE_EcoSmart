# EcoSmart Open Marketplace User Flows

## How the flows connect

The waste generator creates a listing for one selected recycler. The recycler manages their profile and responds to that request. A completed transaction requires both flows: the recycler inspects and funds a final offer, then the generator accepts it.

## Waste generator flow

**Main goal:** find a verified recycler for a supported material, agree a handover, accept the recycler's funded final offer, and receive payment.

1. The generator opens EcoSmart and selects **Create generator account**.
2. The generator enters their full name and email address.
3. EcoSmart sends a one-time email code. The generator enters the code to verify the email address.
4. The generator enters their area or neighbourhood.
5. The generator selects **Check my waste**.
6. The generator scans an item, uploads a photo, or manually selects one supported material: cardboard, PET plastic bottles, aluminium, brass, or glass.
7. If EcoSmart cannot confidently match a scan or photo, it asks the generator to choose a supported material manually. If the item is outside the pilot catalogue, EcoSmart shows **Not supported in this pilot** and the flow ends for that item.
8. EcoSmart shows recyclability guidance and a recycling tip for the selected material.
9. EcoSmart shows verified recyclers that match the generator's area/neighbourhood, selected material, and availability. Each recycler shows an estimated price and clearly labelled unit, such as per kilogram, per item, or per bag.
10. The generator selects one recycler and creates a listing with the material, description or photo, quantity if known, location, and preferred pickup or drop-off arrangement.
11. The generator waits for the selected recycler's response.
12. If the recycler declines, EcoSmart shows other matching recyclers. The generator may choose another recycler and resend the listing; EcoSmart does not automatically send it to every recycler.
13. If the recycler accepts, the generator sees the recycler's approved contact details and confirms the practical pickup or drop-off arrangement.
14. The generator completes the agreed handover directly with the recycler, outside the app.
15. After inspection, EcoSmart shows the generator the recycler-recorded actual weight, funded final offer, and 24-hour expiry time.
16. The generator chooses one outcome:
    - **Accept final offer:** EcoSmart releases the funded amount to the generator's wallet/payment provider account and marks the transaction **Completed**.
    - **Reject final offer:** EcoSmart makes no payment and marks the transaction **Rejected**.
    - **hake no action:** the offer expires after 24 hours, no payment is made, and the transaction is marked **Expired**.
17. The generator can view the time-stamped transaction record, including listing, recycler response, arrangement, actual weight, final offer, decision, and payout result.

## Recycler flow

**Main goal:** become verified, declare what materials to buy, receive relevant direct-supply requests, inspect material, and make a funded final offer.

1. The recycler opens EcoSmart and selects **Create recycler account**.
2. The recycler enters their name, phone number, government ID, photo, recycler licence or registration details, area/neighbourhood, and contact details.
3. EcoSmart records the verification application. The recycler cannot receive listings or make offers until an EcoSmart administrator approves the profile.
4. Once approved, the recycler selects every pilot material they accept: cardboard, PET plastic bottles, aluminium, brass, and/or glass.
5. For each selected material, the recycler sets a non-binding estimated buying price and chooses its unit: per kilogram, per item, or per bag. EcoSmart labels these prices as estimates, not final offers.
6. The recycler sets their availability status to **Available** when ready to receive listings, or **Unavailable** when not ready. Only available recyclers can appear in matching results.
7. EcoSmart shows the recycler a request from a generator only when the request matches the recycler's area/neighbourhood, accepted material, and availability.
8. The recycler opens the request and reviews the material, photo or description, quantity if supplied, location, and preferred pickup or drop-off arrangement.
9. The recycler chooses one outcome:
    - **Accept:** EcoSmart reveals the generator's approved contact details, and both parties confirm the practical pickup or drop-off arrangement.
    - **Decline:** EcoSmart records the decision and shows the generator other matching recyclers. The request is not automatically sent to all recyclers.
10. For an accepted request, the recycler completes the agreed handover directly with the generator, outside the app.
11. The recycler inspects and weighs the material and records the actual weight in EcoSmart.
12. The recycler enters the final amount they are willing to pay, funds that exact amount in the app wallet/payment provider, and then sends the final in-app offer. The recycler cannot send an unfunded final offer.
13. EcoSmart holds the funded amount while the generator has up to 24 hours to respond.
14. If the generator accepts, EcoSmart releases the amount to the generator and marks the transaction **Completed**. No commission is deducted during the pilot.
15. If the generator rejects or does not respond within 24 hours, EcoSmart makes no payout and marks the transaction **Rejected** or **Expired**.
16. The recycler can view the time-stamped transaction record, including inspection, actual weight, funded final offer, generator decision, and payment outcome.

## Shared transaction states

`Draft` → `Sent to recycler` → `Accepted` → `Handover arranged` → `Inspected` → `Funded final offer` → `Generator accepted` → `Completed`

Alternative outcomes: `Recycler declined` → generator chooses another match; `Generator rejected` → `Rejected`; `No generator response for 24 hours` → `Expired`.
