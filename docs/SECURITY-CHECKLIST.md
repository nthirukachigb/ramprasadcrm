# Phase 15 security checklist

This checklist records the hardening currently implemented in the application. It is
for the synthetic demo deployment and must be rechecked against production settings.

| Control | Status | Evidence |
|---|---|---|
| Authentication/session guard | Implemented | `src/proxy.ts` and server-side `requireUser`/`requireRole` guards |
| Row-level authorization | Implemented | Supabase migrations enable RLS and define role policies |
| `nosniff` response header | Implemented | `next.config.ts` |
| Clickjacking protection | Implemented | `X-Frame-Options: DENY` in `next.config.ts` |
| Referrer minimisation | Implemented | `strict-origin-when-cross-origin` in `next.config.ts` |
| Browser capability minimisation | Implemented | `Permissions-Policy` in `next.config.ts` |
| HTTPS transport policy | Implemented for deployed HTTPS environments | HSTS in `next.config.ts`; verify local HTTP is not used for production |
| Privileged Supabase client isolation | Implemented | Service-role client is server-only |
| Audit viewer | Implemented | `/admin/audit`, owner/admin guarded |
| Secret scanning and dependency review | To verify in CI/deployment | Run the repository security pipeline before release |
| CSP and rate limiting | Follow-up | Requires deployment-specific Supabase and authentication endpoints |

No real customer, OEM, pricing, contact, bank, tax or credential data belongs in the
repository or demo environment.
