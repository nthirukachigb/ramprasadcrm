# Decisions Log (Working Assumptions)

**Status:** These are the working answers to every open question in PRD.md, TECH-STACK.md and IMPLEMENTATION-PLAN.md. Each one is a **[Assumption]**. They are made so the build can start without waiting. Each can be changed later with a setting or a forward migration. Confirm them with the business owner when possible.

**Date:** 30 September 2026 · **Applies to:** MVP demo build (synthetic data only)

| ID | Question | Decision (assumption) | Why | How to change later |
|---|---|---|---|---|
| Q-01 | Several OEMs per line? | Yes, several commitments per line are allowed. Only *represented, exclusive* OEMs are limited to one per product, with an owner override. | Keeps the brief's 600+400 example working and respects the owner's ethics rule | Setting on `oem_product` |
| Q-02 | In-house manufacturing? | Track milestones and readiness for any fulfilment type (OEM, in-house, subcontract). No MRP. | The owner said "we need", the brief says "not an ERP" | Phase 2 |
| Q-03 / Q-T11 | Legal entities | One demo tenant "Demo Consulting Pvt Ltd (fictional)". `tenant_org_id` stays on every table. | Unknown real names | Add organisations |
| Q-04 | Who numbers quotes? | System numbers them internally. The OEM number is stored separately. | Supports both | — |
| Q-05 / Q-T4 | Global OEM capacity? | No. Coverage is checked per requirement and per order. | Simpler and safe for MVP | Phase 2 capacity ledger |
| Q-06 | Loss reasons | PRD list + "Quantity split (L1/L2)" | From owner talk | Reference table |
| Q-07 | What takes a week of documentation? | Not built in MVP. Basic quotation PDF only. | Unknown | Phase 2 templates |
| Q-08 | Approval authorities | RCMA, CEMILAC, DGQA, LCSO, MIL, ISO 9001, AS9100 (editable list) | From sources | Reference table |
| Q-09 / Q-T9 | Invoice before dispatch? | Not allowed. Invoicing needs cleared (PDI) and dispatched quantity. | Safer control | `invoice_before_dispatch_allowed` flag |
| Q-10 / Q-T10 | Commission chain | Consultant invoices the OEM. Commission becomes *eligible* when the customer's payment against the OEM invoice is recorded, proportional to partial payments. Owner approves before the commission invoice is raised. | Matches W9 and the brief | `trigger_milestone` setting |
| Q-11 | External user access | None in MVP | Security | Phase 2 portals |
| Q-12 | 500 lines hard limit? | Yes, 500 via a setting | Brief | `max_lines` setting |
| Q-13 | Due-date start | Invoice date + payment terms | Most common | `due_base_event` setting |
| Q-14 | W1 "Master POs" sheet | Treated as order data | Its columns are PO data | Mapping template |
| Q-15 | Source codes (SRM, BUD, Pur Mail) | Kept as editable source channels; meanings shown as "unconfirmed" | Unknown | Reference table |
| Q-16 | "Defence-qualified" subcontractor | Needs at least one valid evidence document on file; owner acknowledges if expired | Evidence, not certification | Rule setting |
| Q-17 / Q-T6 | Retention | Soft delete only. No purge job in MVP. | Legal advice needed | Enable purge job later |
| Q-18 | Trusted workbooks | None imported for real in MVP. Importer proven on synthetic fixtures. | Data quality issues found | Secured staging + owner sign-off |
| Q-19 / Q-T1 | Hosting and data residency | Demo on Vercel + Supabase with synthetic data only. **No real data on public cloud** until the owner decides. Recommended production path: owner-controlled server in India behind VPN. | Owner wants secrecy | Phase 2 hosting |
| Q-20 | Employee reports | Workload counts only, no performance scores | Responsible use | — |
| Q-21 | Government inspection separate from PDI? | Treated as an optional extra milestone; PDI holds the quantities | Simpler | Milestone template |
| Q-22 | LD terms per PO | Optional fields captured. No LD calculation shown. | No legal judgement | Could feature |
| Q-23 | Readiness for all orders? | Available for all, optional per line | Flexible | — |
| Q-24 | Non-INR quotes? | Allowed with exchange rate and date; base INR | W9 lists USD/EUR | — |
| Q-25 | Pass needs owner approval? | Yes | Owner decides bid/no-bid | `pass_requires_owner` setting |
| Q-26 | Automated customer reminders | Internal tasks + drafts only. Human sends. | Brief: no auto-messaging | Phase 2 email |
| Q-27 | Renewal columns in OEM/customer masters | Vendor-registration renewal | Most likely meaning | Mapping template |
| Q-28 | "As per [entity]" payment columns | Ignored (quarantined) on import | Unknown meaning | Mapping template |
| Q-29 | Metres vs numbers | UoM required per line; no conversion unless defined | Avoid silent errors | `ref.uom_conversion` |
| Q-T2 | Supabase or Neon | Supabase | Auth + Storage + RLS in one | Adapters in `lib/platform` |
| Q-T3 | External AI provider | Off in production. Allowed on the demo only (synthetic data) if a key is available. Question picker works without AI. | Confidentiality | `AI_ENABLED` flag |
| Q-T5 | Accounting source of truth | This system for operational tracking only; statutory GST/TDS stays in the accounting package | Not an accounting system | — |
| Q-T7 | Move to owner server | After MVP acceptance, before any real data | Secrecy | Phase 2 |
| Q-T8 | Malware scanning | Demo: allow-list + "unscanned" label. Real uploads need a scanner first. | No free scanner | ClamAV in Phase 2 |
| Q-T12 | Sentry | Not used | Data would leave the stack | — |
| Q-T13 | Demo realism | Copy the workbook *structure* only, fully fictional values | Confidentiality | — |
| Timing | Deadline | None given. Follow the critical path; deploy after every phase. | — | Time-box when a date is known |
