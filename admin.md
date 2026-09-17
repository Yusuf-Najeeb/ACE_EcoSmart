# EcoSmart Administrator Guide & CLI Documentation

This document explains the **Administrator role**, the **Administrator Workspace (Screen 8 · FR-17)**, testing credentials, and the **Admin Management CLI** for creating and promoting administrators.

---

## 1. Active Administrator Test Account

For access and operational testing, an active Administrator account is provisioned in the database:

- **Email**: `yusnaj21@yahoo.com`
- **Name**: `Najeeb Yusuf`
- **Role**: `administrator`
- **Area**: `Headquarters, Lagos`
- **Account Status**: `active`

### How to Sign In:
1. Open the EcoSmart web app at `http://localhost:3000`.
2. Click the **"Sign in"** tab (*Returning User*).
3. Enter `yusnaj21@yahoo.com` and click **Send sign-in code**.
4. Enter the 6-digit one-time passcode (OTP) delivered to your inbox (or check test provider logs).
5. The system automatically verifies your `administrator` role and routes you directly to the **Pilot Administrator Workspace (Screen 8)**.

---

## 2. Administrator CLI Management Tool

EcoSmart includes a CLI utility script located at [`scripts/create-admin.js`](file:///c:/Users/Najeeb/Desktop/ACE%20EcoSmart/scripts/create-admin.js) for provisioning and managing administrators directly from the terminal.

### Available Commands

#### A. Create a New Administrator
Provision a brand-new administrator with custom name and location:
```bash
npm run create-admin -- <email> [fullName] [area]
```
*Example:*
```bash
npm run create-admin -- ops@ecosmart.ng "Operations Lead" "Ikeja, Lagos"
```
*(Or directly using Node: `node scripts/create-admin.js ops@ecosmart.ng "Operations Lead" "Ikeja, Lagos"`)*

#### B. Promote an Existing User
If a user is already registered as a `generator` or `recycler`, running the command will promote their existing account to `administrator` with active status:
```bash
npm run create-admin -- user@example.com
```

#### C. List All Active Administrators
Display all registered administrators in the database:
```bash
npm run create-admin -- --list
```
*Example Output:*
```text
--- Active EcoSmart Administrators ---
1. Najeeb Yusuf (yusnaj21@yahoo.com) - ID: 01f30714-912a-4dd6-ad53-c62e2074ad03 [active]
-------------------------------------
```

---

## 3. Administrator Capabilities (Screen 8 · FR-17)

Once signed in as an administrator, you have access to three core management tabs:

### 1. 📋 Recycler Verification Queue (`Tab 1`)
- Review submitted recycler verification applications.
- Inspect business names, contact details, Government ID documents, CAC registration/waste licences, and yard addresses.
- **Approve**: Immediately unlocks Screen 4 for the recycler to set up material pricing and receive generator listings.
- **Reject with Note**: Sends a structured decision note back to the recycler on Screen 2 so they can correct documents and resubmit.

### 2. 📦 Pilot Material Catalogue Management (`Tab 2`)
- Manage pilot recyclable materials (Cardboard, PET Bottles, Aluminium, Brass, Glass).
- Add new recyclable materials or edit preparation/sorting guidance.
- Toggle active/inactive status to control what materials appear across Generator Screen 3 (Intake) and Recycler Screen 4 (Marketplace Pricing).

### 3. 🔍 Marketplace Records & Audit Trail (`Tab 3`)
- Global search and filtering across all transactions on the marketplace.
- Inspect intake methods (live camera scan, photo upload, manual).
- Audit Escrow wallet payments (funding references, ₦0-commission pilot payouts).
- View time-stamped milestone event history and communication logs (in-app chat messages & call sessions).

---

## 4. Role Separation & Privacy

- **Generators & Recyclers**: Do not see the `⚙ Admin Workspace` button in the header, and cannot access administrative tabs or verification queues. When regular users view their history, they only see their personal transaction records via *"My Records"*.
- **Administrators**: See the `⚙ Admin Workspace` header navigation and are routed directly to the management suite upon login.
