# EcoSmart — account registration

Implements only locked-scope.md must-have #1 / Screen 1: generator or recycler registration with real Twilio Verify SMS, durable SQLite records, and an authenticated account confirmation. Screens 2 and 3 are identified as the next steps but are not implemented. The original root index.html is preserved; the application serves public/index.html.

## Run locally

Requires Node.js 22.13 or newer (tested with 22.19). No dependency installation is needed.

1. Copy `.env.example` to `.env`.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` from your Twilio account and Verify service. Keep secrets local. Configure the service for SMS and a 10-minute code validity, enable the required destination countries, and ensure the account can send to your test phone. Trial accounts may restrict recipients.
3. Run `npm start` and open http://localhost:3000. If changing the port, change APP_ORIGIN too.
4. Run `npm test` for automated checks.

SMS is sent and checked through the [Twilio Verify API](https://www.twilio.com/docs/verify/api). SMS requests may incur provider charges. Missing credentials produce a visible unavailable state, never a simulated code or verified account. Automated tests use isolated provider doubles and temporary databases only; the app has no test-code bypass.

## What is stored

`data/ecosmart.sqlite` stores users, pending registrations, provider verification references, timestamps, hashed session tokens and persistent request limits. No raw OTP codes or raw session tokens are stored. Names, phone numbers and neighbourhoods are private application data. Back up the database appropriately; do not publish the data directory. Cookies are HttpOnly/SameSite=Strict, with seven-day sessions. Set COOKIE_SECURE=true behind HTTPS before deploying. The local server binds to loopback; production deployment is outside this feature.

Nigerian local mobile numbers normalize to +234; other countries require international +country-code format. Codes expire locally after ten minutes; five checks per issuance, 60 seconds between sends, five send attempts per phone/hour, 20 code checks per phone/hour and 80 API requests per IP/hour are enforced. Configure Twilio spending and geographic controls for a public rollout. Limits use the direct socket IP, not untrusted forwarded headers.

Successful verification creates one account per phone, marks generators active and recyclers pending recycler approval, and saves a session that survives refresh and server restart. Existing numbers cannot re-register or change account roles through registration. Returning-user login/account recovery is not included in this registration-only release; after sign-out there is no returning-user login screen yet.

## Manual acceptance checks (real phones required)

- Configure credentials, restart the server, register as a generator using a phone you control, receive and enter its actual SMS code, and confirm the saved name, phone, area, role and Check my waste next step.
- Use a second phone for a recycler; confirm pending recycler approval and Recycler verification application next step.
- Try an incorrect code, wait for expiry, request another code after the cooldown, and complete verification.
- Refresh and restart the server; confirm your session/account persists. Check on your own mobile browser and with SMS autofill.
- Confirm duplicate registration is rejected. Sign out only after testing session persistence (returning-user login is outside scope).
- Confirm SMS delivery timing and country/carrier restrictions with your Twilio configuration. Automated tests cannot establish actual carrier delivery.
