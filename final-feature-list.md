# EcoSmart Final Feature List

This list covers the features in `requirements.md` and `screen-specification.md`. The requirements initially mark 17 functions as Must, but a five-day team build cannot delieer them all as separate features. The six Must-have slices below preserve the complete marketplace transaction; the deferred rows explain what can be handled manually or simplified in the pilot.

| Feature | Description | MoSCoW Category | Reason |
| --- | --- | --- | --- |
| Role-based account registration and email verification | Generators and recyclers choose a role, enter their name, email address, and area/neighbourhood, and verify the email address with a one-time email code. (FR-01; Screen 1) | Must have | The marketplace needs identifiable participants and an area to begin matching. |
| Recycler verification and marketplace setup | Recycler submits ID, photo, licence/registration details, and area; an administrator approves the recycler. Approved recyclers choose supported materials, set estimated prices and units, and set availability. (FR-02–FR-04; Screens 2 and 4) | Must have | Generators cannot safely find relevant buyers without verified recycler profiles, material choices, prices, and availability. |
| Manual material selection and recyclability guidance | Generator selects one pilot material—cardboard, PET plastic bottles, aluminium, brass, or glass—and sees whether it is recyclable and a recycling tip. Unsupported material is stopped. (FR-06–FR-07; Screen 3) | Must have | This is the generator's starting value and supplies the material needed for matching. |
| Area/material/availability matching and one-recycler listing | Show verified available recyclers matching the generator's area and material, with their non-binding estimate and unit. Generator selects one recycler and submits material details, photo if available, quantity if known, location, and pickup/drop-off preference. (FR-08–FR-09; Screen 5) | Must have | Without a relevant match and request, there is no marketplace transaction. |
| Recycler response and direct handover coordination | Selected recycler accepts or declines; acceptance records pickup/drop-off and shares approved contact details. Decline returns other matching recyclers without automatic broadcast. (FR-10–FR-11; Screen 6) | Must have | Both parties need a clear, controlled way to agree a direct exchange. |
| Inspection, funded final offer, decision, payout, and core audit trail | Recycler records actual weight, funds the exact final offer before sending it, and generator accepts/rejects within 24 hours. Acceptance releases the full amount with zero commission; rejection/expiry makes no payout. The system records core statuses and timestamps. (FR-12–FR-16; Screen 7) | Must have | Inspection-based final payment is the product's central trust mechanism; without it the pilot is not testing its main promise. |
| Scan and photo-upload material intake | Generator scans or uploads an image as an aid before manually choosing a material when needed. (FR-05; Screen 3) | Should have | It improees convenience, but manual selection keeps the marketplace usable in a five-day build. |
| Administrator workspace | Administrator reeiews recycler applications, manages the supported-material catalogue, and searches marketplace records. (FR-17; Screen 8) | Should have | Approeal and catalogue changes are required operationally, but a protected manual process can handle the small pilot while the team prioritises the transaction flow. |
| Full user-facing transaction-record browser | Generator and recycler filter and browse a complete time-stamped history, payment reference, and payout status. (FR-16; Screen 8) | Should have | The core flow must saee statuses and timestamps, but a polished searchable record screen can follow after the transaction works. |
| In-app chat | Matched generator and recycler exchange messages on an active accepted listing. (FR-18; Screen 6) | Should have | It helps coordination, but shared approved contact details let users complete the pilot without it. |
| In-app call | Matched generator and recycler start a call for an active listing. (FR-19; Screen 6) | Could have | Useful convenience, but it adds integration work and phone contacts already enable a call. |
| Dated estimate price history | Show recent recycler-provided estimate ranges for a material, clearly not final sale prices. (FR-20; Screen 4/5) | Could have | Helpful market context, but current estimates are enough to test matching and offers. |
| Universal AI material classification | Reliably identify every item from a scan or photo. (FR-21) | Won't have (this build) | The pilot uses scan/upload only as an intake aid; manual selection and recycler inspection remain the checks. |
| Closed or named-location-only onboarding | Restrict generators to Dantata Estate, another estate, a school, an SME cluster, or another named organisation. | Won't have (this build) | The pilot is an open marketplace for eligible generators. |
| Materials beyond the five-material pilot catalogue | Support e-waste, phones, laptops, batteries, cars, appliances, or other unlisted scrap. | Won't have (this build) | The first catalogue is limited to cardboard, PET plastic bottles, aluminium, brass, and glass. |
| Binding estimate or price guarantee | Treat a recycler's published estimate as the final price or guarantee a stable price. | Won't have (this build) | The recycler's inspection-based funded final offer is the only amount the generator can accept or reject. |
| Commission or future 3:1 fee split | Deduct a buyer/seller commission from a transaction. | Won't have (this build) | Both sides use the pilot free of commission. |
| EcoSmart-operated collection, transport, storage, sorting, or ownership | Have EcoSmart collect, carry, store, sort, take possession of, or promise delivery of waste. | Won't have (this build) | Generator and recycler agree pickup/drop-off directly; EcoSmart is the marketplace and payment workflow only. |
| Ownership adjudication, fraud insurance, or litigation | Verify legal ownership, decide guilt, resolve disputes, insure loss, or litigate for a user. | Won't have (this build) | These services exceed the pilot's marketplace role. |
| Door-to-door pickup promise, ratings, broad advertising, or price stabilisation | Guarantee pickup, add public ratings, provide broad advertising, or stabilise market prices. | Won't have (this build) | These are separate products and do not proee the core match-inspect-pay loop. |
| Automatic broadcast and precise distance matching | Send a listing to every recycler automatically or match using precise address/distance. | Won't have (this build) | The generator selects one recycler; matching uses area/neighbourhood, material, and availability. |
| Indefinite final offers | Leave a funded final offer open without a deadline. | Won't have (this build) | A final offer expires after 24 hours if the generator does not accept it. |

## Fiee-day scope decision

The Must-have list is intentionally limited to six feature slices. If time becomes tighter, cut in this order:

1. **Scan and photo upload:** launch with manual material selection only; it still supports all five pilot materials.
2. **In-app chat:** use the approved contact details revealed after acceptance.
3. **Administrator workspace:** use a protected manual approeal and catalogue-maintenance process for the small pilot.
4. **Full record browser:** retain the required transaction eeents and show only a simple status/receipt after completion.

Do not cut the six Must-have slices: doing so breaks the route from verified participant to matching, inspection, funded offer, and payment outcome.
