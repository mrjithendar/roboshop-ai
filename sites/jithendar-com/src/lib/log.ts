/**
 * Structured JSON logs, one object per line, for Loki/Grafana:
 *   {"time":"…","level":"info","msg":"post published","service":"jithendar-com","traceId":"…","spanId":"…", …fields}
 * Never pass secrets, passwords, tokens or full request bodies in fields.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;

type Fields = Record<string, unknown>;

/** Current OpenTelemetry trace/span ids, if a span is active (no-op when tracing is off). */
function traceFields(): Fields {
  try {
    // Loaded lazily so the logger works in any runtime and in tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
    const ctx = api.trace.getActiveSpan()?.spanContext();
    return ctx && api.isSpanContextValid(ctx) ? { traceId: ctx.traceId, spanId: ctx.spanId } : {};
  } catch {
    return {};
  }
}

function serializeError(error: unknown): Fields {
  if (error instanceof Error) return { error: { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 6).join("\n") } };
  return { error: String(error) };
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (order[level] < threshold) return;
  const { err, ...rest } = fields;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    service: "jithendar-com",
    version: process.env.GIT_SHA ?? "dev",
    ...traceFields(),
    ...rest,
    ...(err !== undefined ? serializeError(err) : {}),
  });
  // console.* writes one line to stdout/stderr in Node and works in every Next.js runtime.
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
