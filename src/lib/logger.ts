type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Keys whose values are replaced before a log line is written.
const REDACTED_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      REDACTED_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1),
    ]),
  );
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? "info") as Level;
  return order[level] ?? order.info;
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Structured JSON logger. Sensitive keys are redacted. */
export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
