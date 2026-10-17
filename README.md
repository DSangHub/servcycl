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
