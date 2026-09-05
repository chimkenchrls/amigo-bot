import "dotenv/config";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { config } from "../src/config.js";
import { createGenAI } from "../src/ai/client.js";
import { pickRoastMode, roastImage } from "../src/ai/roast.js";
import { generateReply, toGeminiHistory } from "../src/ai/conversation.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function main(): Promise<void> {
  const imgPath = process.argv[2];
  if (!imgPath) throw new Error("usage: tsx scripts/smoke.ts <image-path>");

  const mimeType = MIME_BY_EXT[extname(imgPath).toLowerCase()] ?? "image/jpeg";
  const genai = createGenAI(config.geminiApiKey);

  const data = readFileSync(imgPath).toString("base64");
  const mode = pickRoastMode();
  console.log(`\n=== ROAST (${mode}) ===`);
  console.log(
    JSON.stringify(
      await roastImage(genai, { data, mimeType, mode, model: config.model }),
      null,
      2,
    ),
  );

  console.log(`\n=== CHAT ===`);
  console.log(
    JSON.stringify(
      await generateReply(genai, {
        history: toGeminiHistory([
          { role: "user", content: "Sam: anyone around?" },
          { role: "model", content: "yeah what's up" },
        ]),
        userTurn: "Dana: yo what's the plan tonight",
        model: config.model,
      }),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
