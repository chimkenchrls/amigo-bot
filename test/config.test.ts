import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const full = {
  DISCORD_TOKEN: "t",
  DISCORD_APP_ID: "a",
  GEMINI_API_KEY: "k",
};

describe("loadConfig", () => {
  it("parses required vars and applies defaults", () => {
    const c = loadConfig({ ...full });
    expect(c.discordToken).toBe("t");
    expect(c.discordAppId).toBe("a");
    expect(c.geminiApiKey).toBe("k");
    expect(c.model).toBe("gemini-2.5-flash");
    expect(c.databasePath).toBe("./data/amigo.db");
    expect(c.logLevel).toBe("info");
  });

  it("honors overrides", () => {
    const c = loadConfig({
      ...full,
      GEMINI_MODEL: "gemini-3-flash-preview",
      DATABASE_PATH: "/data/x.db",
      LOG_LEVEL: "debug",
    });
    expect(c.model).toBe("gemini-3-flash-preview");
    expect(c.databasePath).toBe("/data/x.db");
    expect(c.logLevel).toBe("debug");
  });

  it("falls back to info on unknown LOG_LEVEL", () => {
    expect(loadConfig({ ...full, LOG_LEVEL: "loud" }).logLevel).toBe("info");
  });

  it("throws listing every missing required var", () => {
    expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN/);
    expect(() => loadConfig({})).toThrow(/DISCORD_APP_ID/);
    expect(() => loadConfig({})).toThrow(/GEMINI_API_KEY/);
  });
});
