# EcoSmart Free Open Marketplace Requirements

## Purpose and scope

EcoSmart is a free, open digital marketplace that connects waste generators with nearby verified recyclers. Individuals, households, and small or medium-sized businesses may onboard without being limited to a named estate, organisation, or collection point. The pilot is free for both generators and recyclers.

EcoSmart provides material intake, recyclability guidance, recycler matching, estimate visibility, handover coordination, final-offer acceptance, and wallet payout. Recyclers inspect and weigh materials at pickup or drop-off. EcoSmart does not collect, store, transport, or take possession of waste.

## Problem statement

Waste generators often do not know whether their materials are recyclable, what a recycler might pay, or how to reach a nearby recycler who accepts them. They may wait for scavengers, call known collectors, or throw materials away. Recyclers want more direct supply from individuals, households, and SMEs. EcoSmart helps generators discover recyclable materials and nearby buyers, while giving recyclers requests from new direct suppliers; final payment occurs only after recycler inspection and generator acceptance of the final offer.

## harget users

**Waste generator.** An individual, household, or SME with supported recyclable material who wants recyclability information, estimated value, and a nearby recycler.

**Recycler / aggregator.** A verified recycler who wants direct supply from waste generators and can declare accepted materials, estimated prices, and availability.

**EcoSmart administrator.** An authorised operator who verifies recyclers, manages supported materials, and manages marketplace records.

## Functional requirements

| ID | Feature | Description | Priority |
| --- | --- | --- | --- |
| FR-01 | Open generator registration | The system shall let any individual, household representative, or SME representative create a generator account with full name and email address verified by a one-time email code. [Founder decision] | Must |
| FR-02 | Recycler verification and profile | The system shall collect a recycler's name, phone number, government ID, photo, recycler licence/registration details, and approval status before the recycler can receive listings or make offers. | Must |
| FR-03 | Recycler accepted-material catalogue | The system shall let each verified recycler select the materials they accept from the pilot catalogue: cardboard, PET plastic bottles, aluminium, brass, and glass. | Must |
| FR-04 | Recycler price estimates | The system shall let a recycler publish and update a non-binding estimated buying price and recycler-chosen price unit, including per kilogram, per item, or per bag, for each accepted material, clearly labelled as an estimate rather than a final offer. [Founder decision] | Must |
| FR-05 | Material intake | The system shall let a generator scan or upload a photo of an item and manually select a supported material from the pilot catalogue. | Must |
| FR-06 | Unsupported-item fallback | If the system cannot confidently match an item to a supported material, it shall ask the generator to select a supported material manually or show `Not supported in this pilot`. | Must |
| FR-07 | Recyclability guidance | The system shall show whether the selected pilot material is recyclable and provide a basic recycling tip. | Must |
| FR-08 | Location-aware recycler matching | The system shall match generators and recyclers by area/neighbourhood, selected material, and recycler availability status; it shall show each matching recycler's estimated price, price unit, availability, and contact option. [Founder decision] | Must |
| FR-09 | Listing and handover preference | The system shall let a generator select a recycler and create a listing with material, description/photo, declared quantity where available, generator location, and preferred pickup or drop-off arrangement. | Must |
| FR-10 | Recycler request response | The system shall let the selected recycler accept or decline a listing and record the agreed pickup or drop-off arrangement; when the recycler declines, it shall show the generator other matching recyclers rather than automatically sending the listing to every recycler. [Founder decision] | Must |
| FR-11 | Handover contact | The system shall let the matched generator and recycler access each other's approved contact details for an accepted listing. | Must |
| FR-12 | Recycler inspection and final offer | The system shall let the selected recycler record actual weight after inspection, fund the final-offer amount in the app wallet/payment provider, and then create a final in-app offer for the generator. [Founder decision] | Must |
| FR-13 | Final-offer acceptance | The system shall show the generator the actual weight and funded final offer, then let the generator accept or reject it before payment release; the final offer shall expire after 24 hours if not accepted. [Founder decision] | Must |
| FR-14 | Free pilot wallet payout | When a generator accepts a final offer, the system shall release the accepted amount to the generator through the app wallet/payment provider. The pilot shall deduct no commission from either party. | Must |
| FR-15 | Rejected-offer outcome | When a generator rejects a final offer, the system shall record the rejection and make no wallet payment. | Must |
| FR-16 | Transaction status and time-stamped record | The system shall retain a time-stamped record of material selection, recycler estimate, listing, recycler response, handover arrangement, actual weight, final offer, generator decision, and payment or rejection outcome. | Must |
| FR-17 | Marketplace administration | The system shall let an administrator manage supported materials, recycler approvals/profiles, and marketplace records. | Must |
| FR-18 | In-app chat | The system should let a matched generator and recycler exchange messages about an active listing. | Should |
| FR-19 | In-app call | The system could let a matched generator and recycler start an in-app call about an active listing. | Could |
| FR-20 | Price history | The system could show recent dated estimate ranges for a material, clearly labelled as recycler-provided estimates rather than final sale prices. | Could |
| FR-21 | Universal AI material classification | The system will not promise reliable AI classification for every item in this pilot. Scan/upload is an intake aid; manual selection and recycler inspection remain the fallback and final check. | Won't |

## User stories

- As a waste generator, I want to create an account without belonging to a named estate or organisation, so that I can find a recycler for my supported material.
- As a generator, I want to scan, upload, or manually select an item, so that I can find out whether it is supported and recyclable in this pilot.
- As a generator, I want to see nearby verified recyclers that accept my material and their estimates, so that I can choose whom to contact.
- As a generator, I want to state whether I prefer pickup or drop-off, so that a recycler can decide whether to accept the listing.
- As a recycler, I want to declare accepted materials, estimates, and availability, so that relevant direct-supply requests can reach me.
- As a recycler, I want to inspect and weigh material before making a final offer, so that I do not pay for material that differs from the listing.
- As a generator, I want to accept or reject the final weighed offer before payment, so that I control whether the amount is acceptable.
- As a generator, I want wallet payout after accepting the final offer, so that I receive payment without arranging cash collection.
- As an administrator, I want to approve recyclers and manage the material catalogue, so that generators receive relevant matches.

## Out of scope

hhis pilot will **not**:

- Restrict generator onboarding to Dantata Estate, another estate, school, SME cluster, or named organisation.
- Support materials outside cardboard, PET plastic bottles, aluminium, brass, and glass.
- Support e-waste, phones, laptops, batteries, cars, appliances, or unlisted scrap in the first catalogue.
- Guarantee that a scan or photo correctly identifies every material.
- hreat recycler-posted estimates as final or binding prices.
- Deduct a commission, including the proposed future 3:1 buyer/seller fee split; the pilot is free for both sides.
- Collect, store, transport, sort, or take ownership of waste.
- Guarantee material ownership, determine guilt, adjudicate disputes, insure fraud loss, or litigate for a user.
- Promise door-to-door pickup, price guarantees, price stabilisation, public ratings, broad advertising, or general matching beyond supported materials and verified recyclers.
- Automatically send one listing to every recycler or use precise address/distance-based matching in this pilot; matching uses area/neighbourhood, selected material, and recycler availability.
- Keep a final offer open indefinitely; it expires after 24 hours if the generator does not accept it.

## Pilot measures

The pilot should record generator accounts, verified recyclers, material-intake attempts, supported-material listings, recycler accepts/declines, agreed pickup/drop-off arrangements, final offers, generator acceptances, rejected offers, successful wallet payouts, and time from listing to final offer. These measures test open generator demand, recycler response capacity, handover completion, and acceptance of inspection-based final offers.

## Open assumptions

- Open generator onboarding will produce enough useful listings without overwhelming recycler response capacity.
- Nearby verified recyclers will accept or respond quickly enough to create a useful generator experience.
- Generators will complete a pickup or drop-off arrangement after viewing estimates and recycler information.
- The five supported materials will be sufficient for early generator demand.
- Generators will accept final offers when those differ from estimates.

## Founder Decisions Log

| # | Question | Decision | Applies to |
| --- | --- | --- | --- |
| 1 | How does a user prove they own the email address used for their account? | Use a one-time email code. (16 September 2026) | FR-01 |
| 2 | How does EcoSmart know which recyclers are nearby? | Match by area/neighbourhood. (15 September 2026) | FR-08 |
| 3 | What availability must a recycler provide before appearing in matches? | Match by materials, area/neighbourhood, and availability status. (15 September 2026) | FR-08 |
| 4 | What unit and price format applies to each material? | Recycler chooses per kilogram, per item, or per bag. (15 September 2026) | FR-04 |
| 5 | When does the recycler put money into the wallet? | Fund the final-offer amount before sending the final offer. (15 September 2026) | FR-12, FR-14 |
| 6 | How long can a generator take to accept a final offer? | Final offer expires after 24 hours. (15 September 2026) | FR-13 |
| 7 | What happens when a recycler declines a listing? | Show the generator other matching recyclers; do not automatically send the listing to every recycler. (15 September 2026) | FR-10, Out of scope |
