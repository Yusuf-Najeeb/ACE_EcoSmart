# EcoSmart Open Marketplace Sequence Diagrams

## Main flow: verified recycler, generator listing, and funded final-offer payout

```mermaid
sequenceDiagram
    autonumber
    actor Generator as User: Waste generator
    actor Recycler as User: Recycler
    actor Admin as User: EcoSmart administrator
    participant App as Screen/App
    participant Server as Server
    database DB as Server/Database
    participant Email as Email service
    participant Pay as Wallet/Payment provider

    %% Recycler setup and administrator approval
    Recycler->>App: Create recycler account; submit name, phone, ID, photo, licence/registration, area
    App->>Server: Submit recycler application
    Server->>DB: Save recycler profile as Pending approval
    Admin->>App: Review recycler profile and evidence
    App->>Server: Approve profile
    Server->>DB: Set recycler status to Verified
    Server-->>App: Enable recycler marketplace access
    Recycler->>App: Set accepted materials, estimated price/unit, and availability
    App->>Server: Save catalogue and availability
    Server->>DB: Store accepted materials, non-binding estimates, units, area, and availability

    %% Generator registration and material discovery
    Generator->>App: Create generator account; submit full name and email address
    App->>Server: Request email verification
    Server->>Email: Send one-time email code
    Email-->>Generator: Deliver email code
    Generator->>App: Enter email code and area/neighbourhood
    App->>Server: Verify code and save profile
    Server->>DB: Save verified generator email and area
    Generator->>App: Scan/upload item or manually choose material
    App->>Server: Submit image/selection and area
    Server->>DB: Check pilot catalogue and recyclability guidance
    DB-->>Server: Supported material and recycling tip
    Server-->>App: Show recyclable status, guidance, and tip
    App-->>Generator: Display material guidance

    %% Matching and listing
    Generator->>App: Request matching recyclers
    App->>Server: Send selected material and area/neighbourhood
    Server->>DB: Find Verified + Available recyclers matching area and material
    DB-->>Server: Recycler profiles, estimated prices, units, availability, contact option
    Server-->>App: Return matching recyclers; estimates are not final offers
    App-->>Generator: Show matching recyclers and estimate details
    Generator->>App: Select recycler; create listing with material, photo/description, quantity, location, pickup/drop-off preference
    App->>Server: Create listing for selected recycler only
    Server->>DB: Save listing and time-stamped status Sent to recycler
    Server-->>App: Notify selected recycler of request

    %% Recycler response and direct handover
    Recycler->>App: Review listing and accept request
    App->>Server: Record acceptance and agreed handover arrangement
    Server->>DB: Save acceptance, arrangement, and timestamp
    Server-->>App: Reveal approved contact details to both parties
    opt Matched parties use optional in-app chat
        Generator->>App: Send message about active listing
        App->>Server: Save and deliver message
        Server->>DB: Store message against listing
        Server-->>App: Deliver message to recycler
    end
    opt Matched parties start optional in-app call
        Generator->>App: Start call for active listing
        App-->>Recycler: Present call invitation
    end
    Note over Generator,Recycler: Parties arrange and complete pickup/drop-off directly; EcoSmart does not transport, store, or possess waste.

    %% Inspection, funded final offer, and payout
    Recycler->>App: Record actual weight and final amount after inspection
    App->>Server: Validate accepted listing and create pending final offer
    Server->>Pay: Fund the exact final-offer amount
    Pay-->>Server: Funding confirmed
    Server->>DB: Save actual weight, funded offer, 24-hour expiry, and timestamp
    Server-->>App: Show funded final offer to generator
    App-->>Generator: Display actual weight, final amount, and expiry
    Generator->>App: Accept final offer
    App->>Server: Record acceptance before expiry
    Server->>Pay: Release full funded amount to generator
    Pay-->>Server: Payout confirmed
    Server->>DB: Save payout reference and mark Completed; no commission
    Server-->>App: Show completed, time-stamped transaction record
    App-->>Generator: Display payout result and record
    App-->>Recycler: Display completed record

    %% Administrator management
    Admin->>App: Manage pilot materials, recycler profiles, and marketplace records
    App->>Server: Save approved administrative change or retrieve records
    Server->>DB: Update catalogue/profile or return time-stamped records
```

## Exception flow: unsupported or uncertain material intake

```mermaid
sequenceDiagram
    autonumber
    actor Generator as User: Waste generator
    participant App as Screen/App
    participant Server as Server
    database DB as Server/Database

    Generator->>App: Scan or upload an item
    App->>Server: Submit image for pilot material intake
    Server->>DB: Compare against supported catalogue
    DB-->>Server: No confident supported-material match
    Server-->>App: Return manual-selection fallback
    App-->>Generator: Ask generator to choose cardboard, PET bottles, aluminium, brass, or glass
    alt Generator chooses a supported material
        Generator->>App: Select supported material manually
        App->>Server: Save selected material
        Server->>DB: Record material-intake attempt and selected material
        Server-->>App: Show recyclability guidance and continue to matching
    else Generator cannot choose a supported material
        Server-->>App: Return Not supported in this pilot
        App-->>Generator: Show unsupported-item outcome; do not create a listing
        Server->>DB: Record unsupported material-intake attempt
    end
```

## Other required decision outcomes

- If the selected recycler **declines**, the server records the response and returns other matching recyclers to the generator. It does not automatically broadcast the listing to every recycler.
- If the generator **rejects** a funded final offer, the server records `Rejected` and sends no payout.
- If the generator does not respond within **24 hours**, the server records `Expired` and sends no payout.
- Recycler-posted prices are estimates only. The recycler chooses the unit (per kilogram, per item, or per bag); the funded final offer after inspection is the amount the generator may accept or reject.
- Price history and in-app calls are optional later features. Universal AI identification, unsupported materials, commissions, waste transport/storage, and ownership/dispute decisions are outside this pilot.

## Requirements coverage

The main and exception diagrams cover FR-01 through FR-17. The optional chat path covers FR-18; the optional in-app call is identified as FR-19; price history is noted as a later FR-20 feature; and the uncertainty fallback preserves FR-21's limit on universal AI classification.
