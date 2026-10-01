import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-user";
import { askWithProvider } from "@/lib/ai/provider";
import { isAiEnabled, sanitizeToolCall } from "@/lib/ai/tools";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const question = typeof payload?.question === "string" ? payload.question.trim() : "";
  const selectedTool = typeof payload?.tool === "string" ? payload.tool : "count_open_orders";
  const toolArgs = payload?.args ?? {};

  if (!isAiEnabled()) {
    return NextResponse.json({
      enabled: false,
      mode: "picker",
      message: "AI questions are switched off. Use the structured query picker below.",
      toolName: selectedTool,
      args: toolArgs,
    });
  }

  const validation = sanitizeToolCall(selectedTool, toolArgs);
  if (!validation.success) {
    return NextResponse.json(
      {
        enabled: true,
        message: validation.error,
        mode: "tool-validation",
      },
      { status: 400 },
    );
  }

  const result = await askWithProvider(question || "What is the current open order count?");

  const user = await getCurrentUser();
  if (user) {
    const supabase = await createClient();
    await supabase.from("ai_query_log").insert({
      user_id: user.id,
      tool_name: result.toolCall?.toolName ?? selectedTool,
      question_redacted: question || "",
      request_params: result.toolCall?.arguments ?? validation.data,
      result_count: 0,
      record_ids: [],
      permission_blocked: !result.ok,
    });
  }

  return NextResponse.json({
    enabled: true,
    mode: "provider",
    question,
    toolName: result.toolCall?.toolName ?? selectedTool,
    args: result.toolCall?.arguments ?? validation.data,
    message: result.message ?? "Answer assembled from the tool result.",
  });
}
