# Kitchen Readiness v0 — Architecture

## Closed product loop

`capture/update → inventory → meal capacity → consume → decrement → reporting → restock → replenish`

The north-star metric is **Home Meal Coverage Days**: the minimum number of complete daily meal slots available across breakfast, lunch, dinner and snack.

## Runtime

- **Next.js / Vercel**: mobile-first PWA shell, UI, reporting and daily digest endpoint.
- **Supabase**: Auth, Postgres, RLS, inventory events and meal events.
- **Resend (optional but recommended)**: transactional email delivery for the Kitchen Brief.
- **Local-first fallback**: if Supabase environment variables are absent, the app remains fully usable in localStorage for product validation.

## Security

All database objects are prefixed `hfw_` because the current Supabase project is shared with other products. RLS is enabled on every HFW table. Helper/RPC functions verify membership using `auth.uid()`.

## Why not add more SaaS now?

Another database/backend platform would add operational cost without improving the core loop. Supabase + Vercel are sufficient. Resend is the only extra SaaS recommended in v0 because email deliverability is a distinct capability worth outsourcing.

## Vision roadmap

Do not let computer vision become a blocker for habit formation.

1. v0: manual quantity entry in seconds.
2. v0.2: meal consumption decrements ingredients automatically.
3. v0.3: photo upload → model suggestions → human confirmation.
4. v1: learn corrections per kitchen/container and estimate depletion.

The vision system should never write inventory without a confirmation step until measured accuracy warrants it.
