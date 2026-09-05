# AmIgo

A laid-back, slightly chaotic Discord bot: `/roast` a photo (roast or hype, coin-flip)
and `@mention` it (or reply to one of its messages) for group-chat banter with
per-channel memory.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `DISCORD_TOKEN`, `DISCORD_APP_ID` — from the [Discord Developer Portal](https://discord.com/developers/applications)
   - `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com/apikey)
   - Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`), `DATABASE_PATH`
     (default `./data/amigo.db`), `LOG_LEVEL` (`debug` | `info` | `warn` | `error`,
     default `info`)
3. In the Developer Portal, enable the **Message Content Intent** for the app.
4. Invite the bot with the `bot` and `applications.commands` scopes and the
   **Send Messages**, **Read Message History**, and **Add Reactions** permissions.

## Run

- `npm run deploy -- --guild <guild-id>` — register `/roast` in your test guild (instant)
- `npm run deploy` — register globally (up to ~1h to propagate)
- `npm run dev` — start with reload
- `npm start` — start once

## Test

- `npm test` — unit + store + mocked-AI tests
- `npm run typecheck` — TypeScript, no emit
- `npx tsx scripts/smoke.ts <image>` — one real roast + one real chat reply against
  live APIs (needs a filled-in `.env`; use a local png/jpeg/webp/gif)

## How it works

- **`/roast <image>`** — flips a coin per call: either a savage roast or unhinged
  hype of whatever it sees. Accepts PNG / JPEG / WebP / GIF up to 4 MB. 30s
  per-user cooldown.
- **Chat** — the bot replies when you `@mention` it or reply to one of its
  messages. 5s per-user cooldown.

## Data

Conversation history is stored in SQLite at `DATABASE_PATH` (default `./data/amigo.db`).
Per channel: the last 15 turns are sent to the model (`CHAT_HISTORY_LOAD`) and the
last 30 are retained (`CHAT_HISTORY_KEEP`); older turns are trimmed. Game state
(future feature) will be in-memory only.
