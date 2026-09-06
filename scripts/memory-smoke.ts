import "dotenv/config";
import { config } from "../src/config.js";
import { createGenAI } from "../src/ai/client.js";
import { createDistiller } from "../src/ai/distill.js";

const TRANSCRIPT = [
  "Dana: ok so movie night is officially moving to Saturdays",
  "Eli: finally. tuesdays never worked for me",
  "Dana: also I start bar review next week so I'll be scarce",
  "AmIgo: proud of you na agad",
  "Eli: we should do a group gift for Dana when she passes",
  "Dana: lmao don't jinx it",
].join("\n");

async function main(): Promise<void> {
  const genai = createGenAI(config.geminiApiKey);
  const distiller = createDistiller(genai, config.model);

  console.log("=== first pass (no existing notes) ===");
  const first = await distiller.distill({ existing: [], transcript: TRANSCRIPT });
  console.log(JSON.stringify(first, null, 2));

  if (first.ok) {
    console.log("\n=== second pass (feeding the notes back + a contradiction) ===");
    const second = await distiller.distill({
      existing: first.notes,
      transcript: TRANSCRIPT + "\nDana: actually movie night is back to Fridays",
    });
    console.log(JSON.stringify(second, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
