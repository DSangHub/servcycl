# ServCycl

Installable static PWA for eatery shifts, worker preferences, and charity registration. Serve the repository at the domain root over HTTPS. Offline caching covers the app shell; live shift data needs a connection.

## Connect Supabase

1. Create a dedicated ServCycl project. Run `supabase/schema.sql` in its SQL editor and inspect security advisors.
2. Set the project URL and **publishable** key in `config.js`. Never put a secret or service-role key in the browser.
3. Configure Auth email confirmation and the site's redirect URL. Test sign-up, sign-in, profile edits, posting, and proof uploads.
4. Review charity proof privately in the Supabase dashboard. Set `charities.status='approved'` only after checking the submitted document and current exempt status.

The app deliberately does not claim payments have been made. Stripe funding, Connect onboarding for eligible cash recipients and charities, webhook reconciliation, and a food-credit ledger/redemption flow must be completed before earnings can be delivered. `settlements` is server-only, and no browser can mark a shift completed or a charity approved. Do not use a worker preference as permission to reduce legally owed wages; obtain informed authorization and review applicable employment, wage, tax, and charitable-solicitation rules before launch.

## Fees

- An accepted shift creates a pending settlement for scheduled hours at the posted hourly rate, plus a fixed $4 ServCycl fee charged to the eatery. Actual hours and funding must be confirmed separately.
- Charity registration creates a $25 fee due. The database prevents approval until an authorized backend records it as paid and the charity has been verified.
- A donation reserves 5% of its amount as a ServCycl fee; the charity receives 95%. The worker's earnings preference does not authorize a wage deduction by itself.

These are recorded obligations, **not collected payments**. The connected Stripe session currently exposes only the live `spoylt.org` account. Use a dedicated ServCycl Stripe account and configure checkout, signed webhooks, recipient onboarding, and reconciliation before marking any fee paid or sending money. The `accept_shift_request` RPC intentionally runs with elevated database privileges, checks the signed-in eatery owner and locks both request and shift, and is the only path for accepting a shift; Supabase's security advisor warns about authenticated access to this reviewed function.
