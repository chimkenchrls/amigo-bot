import type { LogLevel } from "../config.js";

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = console.log,
): Logger {
  const emit = (lvl: LogLevel, msg: string, meta?: unknown) => {
    if (RANK[lvl] < RANK[level]) return;
    const flat = msg.replace(/\s+/g, " ");
    const tail = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
    sink(`${new Date().toISOString()} ${lvl.toUpperCase()} ${flat}${tail}`);
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
