import { describe, it, expect } from "vitest";
import { createActivityTracker } from "../../src/lib/activity.js";
import { MEMORY_SETTLE_MS, MIN_MSGS_FOR_DISTILL } from "../../src/constants.js";

const noteN = (t: { note: (id: string) => void }, id: string, n: number) => {
  for (let i = 0; i < n; i++) t.note(id);
};

describe("createActivityTracker", () => {
  it("does not settle a channel that is still active", () => {
    let clock = 0;
    const t = createActivityTracker(() => clock);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL);
    clock += MEMORY_SETTLE_MS - 1;
    expect(t.settled()).toEqual([]);
  });

  it("does not settle a channel with too few messages", () => {
    let clock = 0;
    const t = createActivityTracker(() => clock);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL - 1);
    clock += MEMORY_SETTLE_MS;
    expect(t.settled()).toEqual([]);
  });

  it("settles a quiet channel that saw enough messages, with the count", () => {
    let clock = 0;
    const t = createActivityTracker(() => clock);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL + 2);
    clock += MEMORY_SETTLE_MS;
    expect(t.settled()).toEqual([
      { channelId: "c1", msgCount: MIN_MSGS_FOR_DISTILL + 2 },
    ]);
  });

  it("markDistilled resets the counter until fresh activity accumulates", () => {
    let clock = 0;
    const t = createActivityTracker(() => clock);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL);
    clock += MEMORY_SETTLE_MS;
    t.markDistilled("c1");
    clock += MEMORY_SETTLE_MS;
    expect(t.settled()).toEqual([]);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL);
    clock += MEMORY_SETTLE_MS;
    expect(t.settled()).toEqual([{ channelId: "c1", msgCount: MIN_MSGS_FOR_DISTILL }]);
  });

  it("prunes a long-idle channel that has nothing pending", () => {
    let clock = 0;
    const t = createActivityTracker(() => clock);
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL);
    clock += MEMORY_SETTLE_MS;
    t.markDistilled("c1");
    clock += 25 * 60 * 60 * 1000;
    expect(t.settled()).toEqual([]); // prune sweep runs here
    // fresh activity after a prune is tracked from zero
    noteN(t, "c1", MIN_MSGS_FOR_DISTILL);
    clock += MEMORY_SETTLE_MS;
    expect(t.settled()).toEqual([{ channelId: "c1", msgCount: MIN_MSGS_FOR_DISTILL }]);
  });
});
