import "dotenv/config";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { config } from "../src/config.js";
import { createGenAI } from "../src/ai/client.js";
import { pickRoastMode, roastImage } from "../src/ai/roast.js";
import { generateReplyStream, toGeminiHistory } from "../src/ai/conversation.js";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`  ⏱  ${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
}

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
  const roast = await timed("roast", () =>
    roastImage(genai, { data, mimeType, mode, model: config.model }),
  );
  console.log(JSON.stringify(roast, null, 2));

  console.log(`\n=== CHAT (streamed) ===`);
  let first = 0;
  const start = Date.now();
  let text = "";
  for await (const delta of generateReplyStream(genai, {
    history: toGeminiHistory([
      { role: "user", content: "Sam: anyone around?" },
      { role: "model", content: "yeah what's up" },
    ]),
    userTurn: "Dana: yo what's the plan tonight",
    model: config.model,
  })) {
    if (!first) first = Date.now() - start;
    text += delta;
  }
  console.log(JSON.stringify({ ok: true, text }, null, 2));
  console.log(
    `  ⏱  first chunk: ${(first / 1000).toFixed(1)}s · total: ${(
      (Date.now() - start) / 1000
    ).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
