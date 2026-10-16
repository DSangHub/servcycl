# ServCycl

Installable static PWA for eatery shifts, worker preferences, and charity registration. Serve the repository at the domain root over HTTPS. Offline caching covers the app shell; live shift data needs a connection.

## Connect Supabase

1. Create a dedicated ServCycl project. Run `supabase/schema.sql` in its SQL editor and inspect security advisors.
2. Set the project URL and **publishable** key in `config.js`. Never put a secret or service-role key in the browser.
3. Configure Auth email confirmation and the site's redirect URL. Test sign-up, sign-in, profile edits, posting, and proof uploads.
4. Review charity proof privately in the Supabase dashboard. Set `charities.status='approved'` only after checking the submitted document and current exempt status. Apply `schema.sql`, `fees.sql`, `partial_donations.sql`, then `charity_registration.sql` in order.

The app deliberately does not claim payments have been made. Stripe funding, Connect onboarding for eligible cash recipients, webhook reconciliation, and a food-credit ledger/redemption flow must be completed before earnings can be delivered. `settlements` is server-only, and no browser can mark a shift completed or a charity approved. Do not use a worker preference as permission to reduce legally owed wages; obtain informed authorization and review applicable employment, wage, tax, and charitable-solicitation rules before launch.

## Fees

- An accepted shift creates a pending settlement for scheduled hours at the posted hourly rate, plus a fixed $4 ServCycl fee charged to the eatery. Actual hours and funding must be confirmed separately.
- Charity registration costs $125, due 30 days after registration or upon receipt of the first direct donation, whichever comes first. 501(c)(3) verification remains required; approval does not require advance payment. Only an authorized backend/admin can record `first_donation_received_at` and fee payment. The deadline trigger uses the earlier date and preserves the first recorded receipt. Collection and reminders are not implemented.
- Workers can select 1–100% of earnings for a verified charity. The remainder stays payable in cash. No percentage fee is charged on donations. Donations must go directly to the charity; ServCycl does not collect, hold, or forward them. The ledger records preferences/estimates only and does not initiate a donation. The worker's earnings preference does not authorize a wage deduction by itself.

These are recorded obligations, **not collected payments**. The connected Stripe session currently exposes only the live `spoylt.org` account. Use a dedicated ServCycl Stripe account and configure checkout, signed webhooks, recipient onboarding, and reconciliation before marking any fee paid or sending money. The `accept_shift_request` RPC intentionally runs with elevated database privileges, checks the signed-in eatery owner and locks both request and shift, and is the only path for accepting a shift; Supabase's security advisor warns about authenticated access to this reviewed function.

## Eatery fee checkout

Apply `supabase/eatery_fee_payments.sql`. Deploy `eatery-fee-checkout` and `eatery-fee-webhook` with JWT gateway verification off: checkout validates the bearer token with Auth itself; webhook validates Stripe signatures.

Set Supabase Edge Function secrets `STRIPE_SECRET_KEY` (ServCycl restricted key), `SERVCYCL_STRIPE_ACCOUNT_ID`, and `STRIPE_WEBHOOK_SECRET`. Supabase supplies its URL and service role key. Do not expose these in config.js. Checkout fails closed until configured and verifies the Stripe account matches.

Register webhook URL `https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/eatery-fee-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`. The restricted key needs Checkout Sessions read/write, Accounts read, PaymentIntents read, and inline product/price creation permissions. Test in an isolated Stripe sandbox before setting live credentials.

Each accepted shift has one $4 fee ledger record. Existing open checkouts are reused; Stripe idempotency prevents duplicate creation. Only a signature-verified paid $4 USD session matching the stored session, owner, and request can update the fee ledger. Replayed events are idempotent; refund state is reconciled from Stripe. A success-page redirect does not mark a fee paid. Worker settlements and charitable donations are never marked funded by this flow. Stripe processing fees reduce the net retained by ServCycl.

Activation still requires the correct ServCycl account, secrets, webhook registration, and a sandbox payment verification. No live charge is made by deployment.
