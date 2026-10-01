import { z } from "zod";

export type ToolName =
  | "count_open_orders"
  | "list_wins"
  | "list_losses"
  | "loss_reasons_breakdown"
  | "orders_at_delivery_risk"
  | "pending_oem_responses"
  | "overdue_payments"
  | "expiring_approvals"
  | "pending_quotations"
  | "coverage_gaps";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD format")
  .optional();

const toolSchemas = {
  count_open_orders: z.object({
    status: z.array(z.enum(["received", "under_review", "acknowledged", "amended", "completed", "cancelled"])).optional(),
    customer_id: z.string().uuid({ version: "v4" }).optional(),
  }),
  list_wins: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    customer_id: z.string().uuid({ version: "v4" }).optional(),
  }),
  list_losses: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    customer_id: z.string().uuid({ version: "v4" }).optional(),
  }),
  loss_reasons_breakdown: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    customer_id: z.string().uuid({ version: "v4" }).optional(),
  }),
  orders_at_delivery_risk: z.object({
    risk_status: z.array(z.enum(["at_risk", "warning", "critical"])).optional(),
  }),
  pending_oem_responses: z.object({
    overdue_only: z.boolean().optional(),
  }),
  overdue_payments: z.object({
    min_days: z.coerce.number().int().min(1).max(365).optional(),
  }),
  expiring_approvals: z.object({
    within_days: z.coerce.number().int().min(1).max(365).optional(),
  }),
  pending_quotations: z.object({}),
  coverage_gaps: z.object({
    requirement_id: z.string().uuid({ version: "v4" }).optional(),
  }),
} as const satisfies Record<ToolName, z.ZodTypeAny>;

export const AI_TOOL_DEFINITIONS = [
  {
    name: "count_open_orders",
    description: "Count open or filtered customer purchase orders by status.",
    schema: toolSchemas.count_open_orders,
  },
  {
    name: "list_wins",
    description: "List won or partially won requirements within a date range.",
    schema: toolSchemas.list_wins,
  },
  {
    name: "list_losses",
    description: "List lost or cancelled requirement outcomes within a date range.",
    schema: toolSchemas.list_losses,
  },
  {
    name: "loss_reasons_breakdown",
    description: "Summarise the reasons for losses and record any missing reasons.",
    schema: toolSchemas.loss_reasons_breakdown,
  },
  {
    name: "orders_at_delivery_risk",
    description: "List orders with delivery risk or scheduled delay warnings.",
    schema: toolSchemas.orders_at_delivery_risk,
  },
  {
    name: "pending_oem_responses",
    description: "List OEM responses that are still pending or overdue.",
    schema: toolSchemas.pending_oem_responses,
  },
  {
    name: "overdue_payments",
    description: "List overdue payments and the age bucket from the payment ageing view.",
    schema: toolSchemas.overdue_payments,
  },
  {
    name: "expiring_approvals",
    description: "List approvals expiring within the next number of days.",
    schema: toolSchemas.expiring_approvals,
  },
  {
    name: "pending_quotations",
    description: "List quotations that are still pending action.",
    schema: toolSchemas.pending_quotations,
  },
  {
    name: "coverage_gaps",
    description: "Show requirement lines with uncovered quantity and the missing coverage.",
    schema: toolSchemas.coverage_gaps,
  },
] as const;

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED === "true";
}

export function sanitizeToolCall(name: string, raw: unknown) {
  const tool = AI_TOOL_DEFINITIONS.find((item) => item.name === name);

  if (!tool) {
    return {
      success: false as const,
      error: `Unknown tool: ${name}`,
    };
  }

  const parsed = tool.schema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join(", "),
    };
  }

  return {
    success: true as const,
    data: parsed.data,
  };
}
