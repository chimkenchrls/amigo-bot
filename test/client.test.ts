import { describe, it, expect } from "vitest";
import { createClient } from "../src/client.js";

describe("createClient", () => {
  it("suppresses all mention parsing so model text can't ping users or @everyone", () => {
    const client = createClient();
    expect(client.options.allowedMentions).toEqual({
      parse: [],
      repliedUser: true,
    });
  });
});
