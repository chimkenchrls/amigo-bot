# GitHub publication review

Reviewed on 2026-10-07. Scope: files currently tracked by Git, their working-tree contents, and history reachable from all local Git refs. This is a publication and privacy review, not a complete runtime security audit.

## Executive summary

No credential exposure was detected in 111 tracked files, 293 historical file blobs, or 83 reachable commits. Common Google, Discord, GitHub, AWS, private-key, credential-URL, and credential-assignment patterns were checked. The current local Discord token, Gemini API key, Discord application ID, and owner ID were also compared against those files and commit metadata without printing their values. No matches were found.

The real `.env` and `data/` directory are ignored and were not found in reachable history. `.env.example` contains blank credential fields. Publishing through Git appears reasonable if the personal metadata below is acceptable. Pattern matching is not a guarantee that every possible secret was detected. Remote-only refs, GitHub issues, pull requests, Actions logs, releases, and uploaded artifacts were not reviewed.

## Low severity / privacy choices

### 1. Development session links are public in source and history

References: `docs/superpowers/plans/2026-09-05-amigo-bot-core.md:25` and `docs/superpowers/plans/2026-09-06-amigo-auto-memory.md:29`.

These plans contain Claude Code session URLs. Session URLs also appear in 81 commit messages. The review did not establish whether other people can access those sessions; the links themselves reveal development metadata. Remove them if you prefer not to publish this information. Removing only the current document links leaves historical copies and commit-message links visible. See [GitHub's guidance on removing sensitive data from repository history](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

### 2. Git history contains a personal email address

Commit author metadata contains a personal Gmail address. Publishing existing history will expose it. Decide whether that is acceptable; configuring a GitHub noreply address affects future commits, not existing ones.

### 3. Ignore rules cover current secrets but leave backup gaps

Reference: `.gitignore:2` and `.gitignore:4`.

`.env` and `data/` are ignored. `.env.local`, `.env.production`, root-level `amigo.db`, and `backup.sqlite` are not ignored. No such sensitive tracked files were detected. Consider ignoring `.env.*` with an exception for `.env.example`, plus SQLite databases and their sidecar files, to reduce future accidental commits.

## Publication housekeeping

`package.json` declares ISC, but there is no standalone LICENSE file. Add the intended license text if you want clear reuse terms for other developers.

No source code, credentials, or Git history were modified during this review.
