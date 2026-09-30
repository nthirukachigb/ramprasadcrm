# Defence Contract CRM — Phase 0

A secure CRM for a defence contract consultant. The product principle is
**"One requirement, one connected record, one auditable timeline."**

Phase 0 is the foundations only: a deployed, secure app shell with
authentication, roles, Row Level Security, an audit log, navigation and
placeholders for every future module. It contains **no business data and no
business modules**.

> ⚠️ This repository must contain **no real customer, OEM, pricing, contact or
> credential data**. The demo uses synthetic data only.

---

## What Phase 0 delivers

- Next.js 16 (App Router) + TypeScript strict, Tailwind CSS v4 and shadcn/ui
- Supabase Auth (email + password) with cookie sessions via `@supabase/ssr`
- Five roles (`owner`, `sales`, `operations`, `finance`, `admin`), Postgres
  Row Level Security on every table, and an append-only audit log
- One-click demo login for each role (server-side only; the password never
  reaches the browser)
- An authenticated app shell with a responsive sidebar, top bar, role badges
  and a user menu; placeholder pages for every future module
- Empty, loading, error and not-found states
- Minimal, real Admin screens: users and roles (with a mandatory audit reason)
  and the audit log
- Shared foundations for later phases: `get-user`/`requireRole`, `EmptyState`,
  `ErrorState`, `PageHeader`, `StatusBadge`, `DataTableShell`, and `format.ts`
- Unit tests (Vitest) and one Playwright smoke test 

---

## Stack

Recorded from the versions installed at build time.

| Layer | Package | Version |
|---|---|---|
| Framework | `next` | 16.3.7 |
| UI runtime | `react` / `react-dom` | 19.2.8 |
| Styling | `tailwindcss` | v4 |
| Components | shadcn/ui (Radix UI) + `lucide-react` | — / 1.x |
| Database / Auth / Storage | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) | 2.117.x / 0.12.x |
| Validation | `zod` | 4.x |
| Forms | `react-hook-form` + `@hookform/resolvers` | 7.x / 5.x |
| Tables | `@tanstack/react-table` | 8.21.x (pinned — see DECISIONS D10) |
| Toasts | `sonner` | 2.x |
| Unit tests | `vitest` | 5.x |
| E2E tests | `@playwright/test` | 1.x |
| Lint / format | `eslint` + `prettier` | 9.x / 3.x |
| Scripts | `tsx` | 4.x |

**Hosting:** Vercel (front end) + Supabase (data).

---

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your environment file**

   ```bash
   copy .env.example .env.local
   ```

   Fill in the values (names only — see below).

3. **Apply the database migration** to your Supabase project. Choose one:
   - **CLI:** `supabase link --project-ref <your-project-ref>` then
     `supabase db push` (uses `supabase/migrations/0001_foundation.sql`).
   - **SQL Editor:** open `supabase/APPLY_MANUALLY.sql`, paste the whole file
     into the Supabase SQL Editor, and run it.

   Both paths are idempotent and can be run again safely.

4. **Seed the demo users** (synthetic only)

   ```bash
   npm run seed:users
   ```

   This creates or updates `owner@`, `sales@`, `operations@`, `finance@` and
   `admin@demo.local` with `DEMO_USER_PASSWORD` and assigns one role each. It is
   idempotent.

5. **Run the app**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. With `DEMO_MODE=true` the login page shows a
   "Demo access" card with one button per role.

---

## Environment variables (names only)

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon (publishable) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Seed script and trusted admin work. Never expose. |
| `DEMO_MODE` | **Server only** | `true` enables the demo banner and one-click sign-in |
| `DEMO_USER_PASSWORD` | **Server only** | Password for the synthetic demo users |

Never prefix a server-only variable with `NEXT_PUBLIC_`.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Run the production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright smoke test |
| `npm run seed:users` | Seed/update demo users |
| `npm run format` | Prettier |

### End-to-end tests

The Playwright smoke test needs `DEMO_MODE=true`, a reachable Supabase project
with the migration applied and demo users seeded:

```bash
npm run seed:users
npm run test:e2e
```

To run against a deployed URL, set `SMOKE_BASE_URL`:

```bash
$env:SMOKE_BASE_URL="https://your-app.vercel.app"; npm run test:e2e
```

---

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project** and import the repository. Vercel detects
   Next.js automatically; no `vercel.json` is required.
3. Add the environment variables for **Production** and **Preview**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (mark **Sensitive**)
   - `DEMO_MODE` (set to `true` for the demo deployment)
   - `DEMO_USER_PASSWORD` (mark **Sensitive**)
4. Apply the migration to the Supabase project you point the deployment at
   (CLI or SQL Editor, as above), then run `npm run seed:users` locally with that
   project's credentials.
5. Deploy. Verify: the public URL opens the login page, each one-click role
   button lands on the Dashboard with the correct role badge, and no password is
   ever typed.

---

## Project structure

```text
src/
  app/
    (auth)/login/          # email + password and one-click demo access
    (app)/                 # authenticated shell: dashboard + module placeholders
      admin/users/         # real: users and roles
      admin/audit/         # real: audit log
    layout.tsx  page.tsx  not-found.tsx
  components/
    ui/                    # shadcn/ui primitives
    shell/                 # app shell and navigation
    auth/  admin/          # auth and admin pieces
    empty-state.tsx  error-state.tsx  page-header.tsx
    status-badge.tsx  data-table-shell.tsx  placeholder-page.tsx
  lib/
    auth/                  # get-user, requireRole, pure role helpers, actions
    supabase/              # server / client / admin clients
    schemas/               # Zod schemas
    env.ts  format.ts  utils.ts
  proxy.ts                 # session refresh + auth redirect (Next 16 proxy)
supabase/
  migrations/0001_foundation.sql
  APPLY_MANUALLY.sql
  config.toml
scripts/seed-demo-users.ts
tests/unit/  tests/e2e/
docs/                      # PRD, TECH-STACK, IMPLEMENTATION-PLAN (source of truth)
```

---

## Security notes

- Row Level Security is enabled on every table; the audit log has no update or
  delete policy (append-only, written only by a `SECURITY DEFINER` trigger).
- The service-role key is server-only (`src/lib/supabase/admin.ts` includes
  `import "server-only"`).
- The demo password is read on the server and never sent to the client.
- Storage bucket `documents` is private; downloads require an authenticated,
  RLS-checked request.
