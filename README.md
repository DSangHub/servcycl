# ServCycl

Installable static PWA for eatery shifts, worker preferences, and charity registration. Serve the repository at the domain root over HTTPS. Offline caching covers the app shell; live shift data needs a connection.

## Connect Supabase

1. Create a dedicated ServCycl project. Run `supabase/schema.sql` in its SQL editor and inspect security advisors.
2. Set the project URL and **publishable** key in `config.js`. Never put a secret or service-role key in the browser.
3. Configure Auth email confirmation and the site's redirect URL. Test sign-up, sign-in, profile edits, posting, and proof uploads.
4. Review charity proof privately in the Supabase dashboard. Set `charities.status='approved'` only after checking the submitted document and current exempt status. Apply `schema.sql`, `fees.sql`, `partial_donations.sql`, then `charity_registration.sql` in order.

The app deliberately does not claim payments have been made. Stripe funding, Connect onboarding for eligible cash recipients, webhook reconciliation, and a food-credit ledger/redemption flow must be completed before earnings can be delivered. `settlements` is server-only, and no browser can mark a shift completed or a charity approved. Do not use a worker preference as permission to reduce legally owed wages; obtain informed authorization and review applicable employment, wage, tax, and charitable-solicitation rules before launch.

## Fees

- Eateries choose $10/month for 5 shift postings or $20/month for unlimited postings. No new $4 per-shift charges. Worker compensation remains separate.
- Before the first worker selection, an eatery may post up to five shifts without paying. The first worker request makes the monthly payment due, independently of eatery confirmation. Further postings require a paid subscription. Initial postings count against the first paid month; quotas reset on subsequent paid billing periods. No rollover. Canceled/deleted posts still count.
- Charity registration costs $125, due 30 days after registration or upon receipt of the first direct donation, whichever comes first. 501(c)(3) verification remains required; approval does not require advance payment. Only an authorized backend/admin can record `first_donation_received_at` and fee payment. The deadline trigger uses the earlier date and preserves the first recorded receipt. Collection and reminders are not implemented.
- Workers can select 1–100% of earnings for a verified charity. The remainder stays payable in cash. No percentage fee is charged on donations. Donations must go directly to the charity; ServCycl does not collect, hold, or forward them. The ledger records preferences/estimates only and does not initiate a donation. The worker's earnings preference does not authorize a wage deduction by itself.

## Monthly eatery billing

Apply the historical SQL files in order, followed by `supabase/eatery_fee_payments.sql` and `supabase/eatery_monthly_plans.sql`. Deploy `eatery-fee-checkout` and `eatery-fee-webhook`, including `_shared/billing.mjs`, `_shared/subscriptions.ts`, and `_shared/fees.mjs`. JWT gateway verification is off because checkout verifies Auth bearer tokens and the webhook verifies Stripe signatures.

County Count (`acct_1Tt8NBK7onK0AaO1`) receives ServCycl subscriptions. Supabase Edge Function secrets are `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; Supabase supplies its URL and service-role key. Prefer a restricted key with Accounts read, Customers read/write, Checkout Sessions read/write, Subscriptions read, Invoices read, and customer portal session creation. PaymentIntents read remains needed to reconcile historical $4 refunds. Never expose these keys in config.js.

Live catalog:

| Plan | Price | Product |
| --- | --- | --- |
| $10/month, 5 postings | price_1URcC0K7onK0AaO1rnffUVm1 | prod_VSXGFFVuGh30OH |
| $20/month, unlimited | price_1URcC4K7onK0AaO1cJ346vnm | prod_VSXGC4tyPJSf11 |

Dedicated portal configuration: `bpc_1URcCaK7onK0AaO1GSzqjV38`. Customers can update payment methods, upgrade with proration, downgrade at period end, or cancel at period end. Cancellation retains access through the paid period. Posting quotas use the unchanged billing anchor, so plan changes do not reset usage.

Existing webhook URL: `https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/eatery-fee-webhook`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, and `charge.refunded`.

A signed event triggers retrieval of current subscription and latest invoice state; only a recognized monthly price, quantity one, matching customer/owner, active subscription, and paid invoice grant posting access. Failed/unpaid or expired subscriptions block new posts. SQL serializes quota checks, keeps an immutable posting-usage ledger, and prevents browser writes to billing. Checkout locks and Stripe idempotency reuse sessions and prevent duplicate subscriptions. Refresh billing reconciles current Stripe state after a redirect; redirects alone do not grant access.

Historical $4 receipts and settlements stay intact, including refund reconciliation. Old clients requesting a $4 checkout receive an instruction to refresh. New worker settlements carry zero per-shift service fee; confirming a worker is still required for placement. Monthly subscription payments never fund worker earnings or charitable donations. No existing customer is automatically subscribed by this migration.

Validation: `node --test tests/monthly-*.test.mjs`; SQL rollback verification in `tests/monthly-billing.sql`. A real subscription checkout and renewal must still be verified by a customer; deployment itself does not charge anyone.

## Available workers and account access

Apply `supabase/worker_availability.sql` after the existing migrations. The Available tab is next to Find shifts. Workers opt in or out with a checkbox; `public.available` stores their name, ZIP, availability, and server timestamp. Saved eatery accounts may read opted-in listings; workers may read/edit only their own availability. Emails, Auth records, and earnings preferences are not exposed in the directory. Source name/ZIP snapshots stay synchronized with worker profiles. The RLS-protected, security-invoker `save_worker_availability` RPC preserves existing earnings preferences. Existing workers remain unlisted until they opt in.

New accounts collect name, ZIP, email, password, and optional availability. Name/ZIP/availability are profile metadata, never authorization claims. After email confirmation and authentication, the client initializes a missing worker profile and availability through the RPC. Existing accounts sign in with email/password without re-entering profile details.

Password visibility buttons have accessible labels and pressed states. Forgot password sends the Supabase recovery email to the address entered, redirecting to the existing allowed `https://servcycl.com/` URL. `PASSWORD_RECOVERY` opens the new-password form; matching passwords are submitted through `auth.updateUser`. Passwords remain in Supabase Auth. Verify an actual recovery email with an account you control; automated checks do not send emails.

Validation: `node --test tests/account-availability.test.mjs`; run `tests/worker-availability.sql` inside a transaction and roll back.

## Worker membership, immediate shift texts, portfolios

Apply `supabase/worker_membership_portfolio.sql` and then `supabase/sms_dispatch_schedule.sql`. A saved worker profile creates a membership with SMS off. Workers privately save their US phone, verify it, explicitly opt in, or turn texts off. Changing the phone clears its verification and opt-in. Email, phone, consent, verification attempts and notification jobs are never visible to eateries.

Deploy `member-sms`, `dispatch-shift-sms`, and `worker-sms-webhook` with `_shared/sms.mjs` and gateway JWT verification off. Member verification validates Auth bearer tokens itself, the dispatcher validates a server-only random token stored in `sms_dispatch_settings`, and the Twilio webhook validates its HMAC signature. Browser origins are restricted on the member endpoint. Verification sends/checks are rate-limited in the database.

SMS activation requires these **Supabase Edge Function secrets** from the same Twilio account:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_NUMBER` for a direct sender)

Use an SMS-capable approved sender in the Messaging Service. Configure its incoming-message webhook (POST) as `https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/worker-sms-webhook`, with Advanced Opt-Out enabled. The sender also uses this URL for delivery callbacks. STOP disables SMS opt-in; HELP returns account instructions. START does not automatically restore the app opt-in; the member must explicitly opt in again. Confirm actual verification, opt-in, new-post delivery, and STOP using a controlled phone before describing SMS as operational.

`member-sms` GET returns only a readiness flag. The website clearly says alerts await setup when credentials are absent. Credentials existing does not certify provider delivery or sender approval. No live texts have been sent by this deployment.

New open, future shifts enqueue unique jobs for verified opted-in members in the eatery's ZIP (excluding the eatery owner). A minute-based Cron dispatcher claims jobs with row locks, rechecks consent/phone/ZIP/shift availability, and submits up to ten texts per run. This usually starts within a minute once configured, with backlog/provider delays possible. Jobs expire after one hour or at shift start; no old alerts are sent after late setup. HTTP 429 responses can retry up to three attempts. Uncertain provider results are recorded as unknown and never automatically resent. Provider acceptance and delivery status are recorded separately. Server-only tables deliberately have RLS with no client policies.

The owning eatery can use **Confirm worked shift** after the accepted shift's scheduled end. The owner-checked, row-locking `confirm_worked_shift` RPC changes it to completed and a private trigger appends exactly one immutable work record. Confirming work does not mark wages paid. Merely posting or accepting a shift does not add a worked portfolio entry. Eateries may set **Good** and **Will hire again** on their own completed shifts. Workers cannot grade themselves, fabricate records, or confirm their own work. Workers read their own history; eateries can read portfolios for opted-in available workers or workers associated with their shifts. The reviewed RPC intentionally uses SECURITY DEFINER because clients cannot directly change shift status.

Validation: `node --test tests/*.test.mjs`; run `tests/membership-portfolio.sql` in a transaction and roll it back. Tests cover membership defaults, ZIP-based queue creation, employer-only completion, no portfolio entry on acceptance alone, grading ownership, private phone state, and phone change revocation. SMS formatting and Twilio signature validation have local tests. Actual SMS delivery still requires provider setup and a controlled live verification.

## Food-credit wallet, gifting, redemption and Co-Op

Apply `supabase/food_credits.sql` after the existing migrations. Open **Food credits** in the PWA. No additional payment provider, secret, or QR subscription is needed. The pinned `qrcode-generator` 1.4.4 library is served locally with its MIT license; camera scanning uses feature-detected BarcodeDetector with a paste/type fallback.

**Issuing credits:** an eatery first saves its menu/use rules and optional gifting/Co-Op participation. Only its own completed shifts whose settlement preference is `food_credit` are eligible. It sends a positive agreed amount no greater than the recorded shift estimate. The worker reviews the amount and snapshotted rules and explicitly accepts or declines. Acceptance creates a credit lot and an immutable issuance ledger entry. One pending/accepted offer is allowed per shift; declined or withdrawn offers can be replaced. No historical settlement or pending estimate is automatically converted. The existing wage-payment status is never marked paid by issuing or accepting credits.

**Wallet/gifts:** members open the wallet once to obtain a random recipient code, which they can share privately. Gifts require an authenticated sender, another valid member code, a transferable lot, and enough unreserved credits. Original issuer, usage terms, transfer permission and Co-Op eligibility remain attached to gifted lots. No email lookup or public user directory is required. Credits issued in this first release have **no expiration**; custom expiration controls are not enabled. Updating eatery rules only affects future offers.

**Redemption:** a member selects the exact eatery and amount. The server reserves those credits for ten minutes and returns a random code; the browser displays it as a QR link using a URL fragment. A code cannot be used to gift/spend the reserved amount elsewhere. The selected eatery signs in, scans or pastes the code, previews it, and explicitly confirms redemption. Wrong merchants, expired/cancelled codes and reused codes are rejected. Members can cancel unspent codes, or let their reservations expire. Mistaken redemptions can be voided by the redeeming eatery while no reimbursement payment has been reported; a compensating ledger entry restores the credits.

**Co-Op:** both eateries must enable participation. An issuer proposes a directional agreement specifying the maximum outstanding reimbursement. The accepting eatery explicitly agrees to accept those credits and receive 100% face-value reimbursement. Reverse acceptance needs its own agreement. Only active agreements can be used, and the outstanding cap is checked under a row lock at redemption. Either party can stop future redemptions; existing debt remains recorded. Issuers report payments made outside ServCycl with a reference; the redeeming eatery must confirm receipt before the reimbursement is settled. This feature records reconciliation and does not initiate bank transfers or collect merchant funds.

**Transaction safety:** money-like amounts are integer cents, with positive balances and database constraints. Gift, QR creation, redemption and reversal operations lock the affected lot; reservations count against available credit. Accepted offers and QR state changes prevent repeated issuance/spending. Mutating requests use unique actor-scoped operation keys and database advisory locks. Exact retries return the stored result; reusing a key with changed parameters is rejected. The browser persists outstanding retry keys in sessionStorage until it receives a successful result.

**Permissions:** public credit tables are read-only to clients and protected by RLS. Wallets, codes and history are private; offers, agreements and reimbursement records are limited to the relevant parties. The public RPC is SECURITY INVOKER and calls a private, fixed-search-path SECURITY DEFINER implementation that validates `auth.uid()` and ownership on every operation. Existing private functions retain their revoked client execute privileges. No server key is embedded in browser code.

Validation: `node --test tests/*.test.mjs`; run `tests/food-credits.sql` inside a transaction and roll it back. The SQL suite covers worker offer consent, private wallets, duplicate issuance/replay, gifting with inherited terms, reservations, wrong merchants, reused QR codes, Co-Op acceptance/caps, two-sided reimbursement confirmation, reversals, ledger conservation, and unchanged wage-payment status. These tests create only rollback fixtures, not real member balances or merchant debt. A controlled merchant/member browser redemption and device-camera check should be performed before operational use.
