import { z } from "zod";

/**
 * Public environment variables. Safe to import from both the browser and the
 * server. Parsing is lazy so a missing value produces a clear, actionable error
 * at first use rather than crashing unrelated build steps.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is missing")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing"),
});

/**
 * Server-only environment variables. Never exposed to the browser. Parsed
 * lazily and only on the server.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEMO_USER_PASSWORD: z.string().min(6).optional(),
  FIELD_ENCRYPTION_KEY: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedPublicEnv: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error, "public"));
  }
  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() was called in the browser. Server environment variables must never reach the client.",
    );
  }
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DEMO_MODE: process.env.DEMO_MODE,
    DEMO_USER_PASSWORD: process.env.DEMO_USER_PASSWORD,
    FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
  });
  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error, "server"));
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Use when a server-only capability genuinely requires the value (for example
 * the demo sign-in action). Returns the value or throws a clear error.
 */
export function requireServerVar(
  name:
    | "SUPABASE_SERVICE_ROLE_KEY"
    | "DEMO_USER_PASSWORD"
    | "FIELD_ENCRYPTION_KEY",
): string {
  const value =
    name === "SUPABASE_SERVICE_ROLE_KEY"
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : name === "DEMO_USER_PASSWORD"
        ? process.env.DEMO_USER_PASSWORD
        : process.env.FIELD_ENCRYPTION_KEY;
  if (!value) {
    throw new Error(
      `${name} is required for this operation but is not set. Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

function formatEnvError(error: z.ZodError, scope: string): string {
  const details = error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  return `Invalid or missing ${scope} environment variables:\n${details}\nCopy .env.example to .env.local and fill in the values.`;
}
