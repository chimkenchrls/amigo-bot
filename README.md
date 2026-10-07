# AmIgo

A Tagalog-speaking Discord bot powered by Google Gemini. Chat with it, roast photos, save memories, study, or play Werewolf with your server.

## Features

- Chat by mentioning the bot, replying to it, or saying “amigo”.
- `/roast` — roast or hype a photo.
- `/remember`, `/facts`, `/forget` — manage conversation memory and saved notes.
- `/study` — toggle study mode.
- `/werewolf` — start a Werewolf game.

## Setup

Requires Node.js 20 or newer.

```sh
npm install
cp .env.example .env
```

Fill in `DISCORD_TOKEN`, `DISCORD_APP_ID`, and `GEMINI_API_KEY` in `.env`. Get your Discord credentials from the [Discord Developer Portal](https://discord.com/developers/applications) and a Gemini key from [Google AI Studio](https://aistudio.google.com/apikey). Optional settings are listed in `.env.example`.

Enable **Message Content Intent** in the Discord Developer Portal. Invite the bot with the `bot` and `applications.commands` scopes and **Send Messages**, **Read Message History**, and **Add Reactions** permissions.

Register commands in your server, then start the bot:

```sh
npm run deploy -- --guild <guild-id>
npm start
```

Use `npm run deploy` to register commands globally, or `npm run dev` for development with automatic reload.

## Development

```sh
npm test
npm run typecheck
```

## Data

Conversation history and saved notes are stored locally in SQLite at `./data/amigo.db` by default. Relevant messages, notes, and submitted images are sent to Gemini to generate responses. Keep `.env` and the database private.
