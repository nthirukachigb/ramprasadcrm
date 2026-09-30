# Decisions

This file records decisions made under time pressure with the client
unavailable. They are the **safest simple option** at the time and should be
revisited with the business owner.

## Client-provided defaults (from the Phase 0 brief)

- **D1 — OEM capacity** is tracked **per requirement/order commitment**, not as
  a global capacity. Global capacity is deferred to Phase 2.
- **D2 — Invoicing model:** the OEM invoices the customer; the consultant raises
  a **commission invoice to the OEM**.
- **D3 — Commission** is earned **after the OEM receives the customer payment**
  (the OEM-payment milestone); the percentage comes from the per-OEM agreement.
- **D4 — Historical Excel data is untrusted** until it passes the import
  preview. The demo uses **synthetic data only**.
- **D5 — Loss reasons:** Price, Technical non-compliance, Delivery timeline,
  Competitor preference, Quantity/capacity, Cancelled, Not pursued, Other.
- **D6 — Notifications are in-app only.** No automatic external email/WhatsApp.
- **D7 — The AI "Ask" feature is read-only, grounded and feature-flagged**
  (built in a later phase).
- **D8 — Currency is INR by default.** Quantity allows decimals with a unit of
  measure (`numeric(14,3)` per the brief's model guidance).
- **D9 — Final bid price, OEM selection, overrides and dispatch holds always
  require human approval.**

## Decisions made during Phase 0

- **D10 — Pinned `@tanstack/react-table` to v8.** The npm `latest` at build time
  was v9.2.4, whose API (`useTable`, `createCoreRowModel`, feature wiring) is a
  significant break from the widely-used v8 API. v8.21.3 is stable and is used
  by `DataTableShell`. Revisit when v9 documentation and ecosystem support
  mature.
- **D11 — Used `proxy.ts`, not `middleware.ts`.** Next.js 16 deprecated the
  `middleware` file convention and renamed it to `proxy` (Node.js runtime). The
  brief asked for `middleware.ts`; `src/proxy.ts` provides the same session
  refresh and unauthenticated redirect while avoiding the deprecation. The
  `middleware` name still works in Next 16 if the team prefers it.
- **D12 — The app lives under `src/`.** The brief required the `src/` directory
  and the `@/*` import alias, so the existing root `app/` was moved to
  `src/app/` and `tsconfig.json` paths were updated to `./src/*`.
- **D13 — Foundation table naming follows the Phase 0 brief**, not
  `docs/TECH-STACK.md`. The brief specifies `profiles`, `user_roles`,
  `public.has_role` / `has_any_role`, `audit_events`, `audit_row_change`,
  `set_updated_at`. TECH-STACK suggested `app_user`, `app.*` schemas and
  `audit.audit_event`. The brief's names are used for Phase 0; later phases may
  introduce the `app`/`audit` schemas for business tables without renaming these.
- **D14 — Role changes go through an RPC (`admin_set_user_role`).** The brief
  requires a confirmation reason to be recorded. The generic audit trigger reads
  a transaction-local `app.audit_reason`; a `SECURITY DEFINER` RPC is the only
  write path to `user_roles`, so the reason is captured atomically and the admin
  check happens inside Postgres (defence in depth on top of RLS).
- **D15 — Prettier uses 2-space indent and double quotes** with
  `prettier-plugin-tailwindcss` for class sorting.
- **D16 — Phase numbers on placeholders are best-effort** from
  `docs/IMPLEMENTATION-PLAN.md` (for example Requirements = Phase 2) and may be
  refined as the plan is sequenced.
- **D17 — Vitest tests are pure logic only** (`format.ts`, role helpers) and run
  in the `node` environment; no jsdom/Testing Library was added, because the
  brief only required unit tests for `format.ts` and `requireRole` logic. The
  Playwright smoke test covers rendering and role-based navigation.
- **D18 — The smoke test logs in as Admin to assert the Admin navigation
  appears.** An Owner login does **not** show Admin (Admin is hidden unless the
  admin role is held, per the brief). A second assertion verifies Owner hides
  Admin. This resolves the brief's contradictory example ("Owner … sidebar shows
  Admin").
- **D19 — `vercel.json` was not added.** A standard Next.js app on Vercel needs
  no custom configuration.
- **D20 — Storage update policy omitted.** Only read, upload (authenticated) and
  delete (admin) policies are defined on the private `documents` bucket. No
  update policy avoids a dependency on the type of `storage.objects.owner`.
- **D21 — `DEMO_MODE` and other server variables are parsed lazily** in
  `src/lib/env.ts` so the production build does not fail when they are absent;
  a clear error is thrown at first use.

## Decisions made during Phase 1 (master data)

- **D22 — Multi-tenancy is deferred; the demo is single-tenant.** The PRD
  (Q-03) and TECH-STACK suggest `tenant_org_id` on every business table with an
  `organisation` record. Phase 1 keeps the simple Phase 0 model and omits
  tenant scoping rather than add an organisation-membership system that would
  affect every RLS policy. Revisit before any second tenant or real data.
- **D23 — Sensitive fields use AES-256-GCM field encryption**
  (`src/lib/crypto.ts`, key `FIELD_ENCRYPTION_KEY`, base64 32 bytes). Tax
  registration values and partner bank details are stored as `v1:<iv>:<tag>:<ct>`
  payloads with a `*_last4` column for masked display. The key never reaches the
  browser.
- **D24 — Restricted tables use narrow RLS.**
  `partner_bank_account`: Owner + Finance only. `tax_registration` and
  `commission_agreement`: Owner, Finance, Admin. `portal_reference`: Owner,
  Sales, Finance, Admin. Contacts: Owner, Sales, Operations, Admin. Everything
  else is readable by any authenticated user and writable by Owner, Sales,
  Operations, Admin.
- **D25 — Exclusive representation is enforced in the database.** A trigger
  blocks a second represented OEM when an exclusive one exists;
  `public.create_partner_product(...)` is the approved write path and sets an
  `app.exclusivity_override` when an Owner/Admin passes `p_override` with a
  reason. The reason is also written via `app.audit_reason`.
- **D26 — Overlapping commission agreements are rejected by a trigger**, not a
  `btree_gist` exclusion constraint, so the migration needs no extension and
  can return a clear, testable error (`OVERLAPPING_AGREEMENT`).
- **D27 — Unit of measure is a controlled list in the app and `not null` in the
  database**, satisfying "a product without a UoM cannot be saved".
- **D28 — Master records are soft-deleted** (`is_active`) and Phase 1 defines no
  DELETE policies, so history cannot be silently removed.
- **D29 — One declarative create dialog** (`components/masters/forms.tsx` +
  `record-dialog.tsx`) drives every master form. Client validation is light;
  the server-side Zod schemas in `src/lib/schemas/masters.ts` are authoritative,
  so there is a single source of validation truth and less duplicated UI.
- **D30 — Approval wording is "evidence on file"**, never "compliant". A
  certificate with no expiry date is treated as valid evidence; the UI shows
  No evidence / Expired / Expiring / Evidence on file (valid).
- **D31 — Deferred to later phases:** tenant/organisation scoping; contact
  field masking per role; margin hiding in pricing history; merge approval for
  fuzzy duplicates; product approval acknowledgements at quotation approval;
  and a dedicated bank-detail reveal audit (the whole table is already
  Owner/Finance only).

---

## What Phase 1 (master data) needs from this foundation

Phase 1 will add customers, OEMs/partners and contacts, and products/part
numbers. It builds directly on Phase 0:

- **Auth and identity:** `profiles` and `user_roles` already exist. Phase 1
  should attend to the TECH-STACK idea of an `organisation` / `tenant_org_id`
  if multi-entity support is confirmed (PRD C-03), and may add the `app` schema
  for business tables.
- **Audit:** attach `public.audit_row_change()` to every new business table.
  Use the `app.audit_reason` transaction setting for human reasons on sensitive
  changes (as `admin_set_user_role` does).
- **RLS pattern:** copy the Phase 0 policy style — `has_role()` /
  `has_any_role()` helpers, `SECURITY DEFINER` with a fixed `search_path`, no
  delete policy (soft delete), and owner/admin read-all rules.
- **Updated-at:** reuse `public.set_updated_at()`. Business tables should also
  add `created_by`/`updated_by` and a `row_version` for optimistic locking
  (TECH-STACK §8.2).
- **Server-side helpers:** reuse `requireRole()` / `requireRoleOrRedirect()`,
  the `defineAction`-style Zod validation in Server Actions, and the
  `EmptyState` / `DataTableShell` / `PageHeader` components.
- **Storage:** the private `documents` bucket already exists for evidence and
  attachments; Phase 1 introduces `document` metadata and link tables.
- **Formatting:** `formatINR`, `formatQty` and `formatDate` are ready for money,
  quantity and dates. Part numbers must be treated as strings, never numbers.
- **Approvals/skills for later gates:** D9 requires human approval for material
  decisions; the approval framework itself is scheduled in the implementation
  plan and should land before Phase 5 (quotation approval) and Phase 7 (PO
  mismatch).
