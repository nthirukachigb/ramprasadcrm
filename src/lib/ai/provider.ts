import { redactSensitiveText } from "@/lib/ai/redact";
import { isAiEnabled } from "@/lib/ai/tools";

export interface ProviderToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ProviderResult {
  ok: boolean;
  toolCall?: ProviderToolCall;
  message?: string;
}

export async function askWithProvider(question: string): Promise<ProviderResult> {
  const cleaned = redactSensitiveText(question).trim();

  if (!cleaned) {
    return {
      ok: false,
      message: "Please enter a question to search the catalogued data.",
    };
  }

  if (!isAiEnabled()) {
    return {
      ok: false,
      message: "AI questions are switched off. Use the structured query picker instead.",
    };
  }

  const provider = process.env.AI_PROVIDER ?? "mock";
  const model = process.env.AI_MODEL ?? "mock-model";

  if (!process.env.AI_API_KEY && provider !== "mock") {
    return {
      ok: false,
      message: "The AI provider is not configured. Falling back to the picker.",
    };
  }

  return {
    ok: true,
    toolCall: {
      toolName: "count_open_orders",
      arguments: { status: ["received", "under_review", "acknowledged"] },
    },
    message: `Model ${model} via ${provider} received a sanitised question for approval.`,
  };
}
