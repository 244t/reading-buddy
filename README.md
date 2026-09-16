# Reading Buddy

Read an English book in your browser and discuss it with Claude Code or Codex CLI,
which always know **which sentence you are looking at**.

```
Chrome tab (any web page)
  └─ extension: visible paragraphs + selected text ──POST──▶ hub (127.0.0.1:8737)
                                                               └─ MCP /mcp ──▶ Claude Code / Codex CLI
                                                                                 reading_now, reading_section,
                                                                                 reading_note, reading_list
```

- **Pull-based, token-cheap.** The extension keeps the hub up to date; the AI fetches
  "what is on screen" only when you ask a question (one call, ~1–2k tokens).
- **Nothing leaves your machine.** The hub listens on localhost only. No API keys:
  the AI is whatever CLI you already use.
- **Works on any HTML page** — the extension reads the DOM directly, so paywalled or
  login-only pages work too. No fetching or HTML parsing on the server.
- **Several books at once.** The hub remembers the last position per URL; each session
  can pin itself to one book with the `book` filter.

## Setup

Requirements: macOS (launchd for the resident hub; the hub itself is plain Node), Node ≥ 20, Chrome.

```sh
git clone https://github.com/244t/reading-buddy && cd reading-buddy
npm install
npm run ext              # builds extension/dist
sh deploy/install.sh     # resident hub via launchd (or: npm run hub)
```

1. **Extension**: open `chrome://extensions`, enable *Developer mode*, *Load unpacked* → `extension/dist`.
   Reload any tab you were already reading (content scripts are not injected into existing tabs).
   The toolbar badge shows `on` once the hub receives data.
2. **Claude Code**:
   ```sh
   claude mcp add -s user --transport http reading-buddy http://127.0.0.1:8737/mcp
   cp -r skills/read ~/.claude/skills/     # adds the /read skill
   ```
3. **Codex CLI** (or any other MCP-capable agent):
   ```sh
   codex mcp add reading-buddy --url http://127.0.0.1:8737/mcp
   ```
   and add a few lines like these to your own `AGENTS.md` (global `~/.codex/AGENTS.md` or per project):
   ```markdown
   ## Reading partner
   The user reads books in Chrome. When they refer to what they are reading ("this sentence",
   "here", "this word"), call the MCP tool `reading_now` before answering; the selected text is
   what they mean. Use `reading_section` for questions beyond the screen, `reading_note` when
   they say "note this", and pass `book: "<url or title substring>"` if the session is about one book.
   ```

Check: select some text in the page, then `curl -s localhost:8737/state`.

## Usage

Open the book in Chrome, start `claude` anywhere, type `/read` (or `/read sre-book` to pin
a book). The assistant confirms which page you are on, then answer questions like
"what does *toil* mean in this sentence?" — it calls `reading_now` first and answers
with the selected text and surrounding paragraphs in context. Say "note this" to append
the conclusion to `~/.local/state/reading-buddy/notes/<page>.md`.

The `/read` skill answers in Japanese by default; edit `skills/read/SKILL.md` to change the
language or the discussion style.

## MCP tools

| tool | returns |
|---|---|
| `reading_now(book?, maxChars?)` | URL, title, heading path, selected text with neighbouring blocks, visible blocks |
| `reading_section(book?, heading?, maxChars?)` | all blocks under a heading (default: the section on screen) |
| `reading_note(book?, text)` | appends a note with URL + selection to the notes file |
| `reading_list()` | pages seen so far, most recent first, with progress |

`book` is a case-insensitive substring of the URL or title; omit it to use the tab you looked at last.

## Configuration

| env / file | default | meaning |
|---|---|---|
| `READING_BUDDY_PORT` | `8737` | hub port (also change `HUB` in `extension/src/background.ts`) |
| `READING_BUDDY_STATE_DIR` | `~/.local/state/reading-buddy` | `current.json` and `notes/` |
| `READING_BUDDY_LABEL` | `com.reading-buddy.hub` | launchd label used by `deploy/*.sh` |

Logs: `~/Library/Logs/reading-buddy-hub.log`. Restart after editing the hub:
`launchctl kickstart -k gui/$(id -u)/com.reading-buddy.hub`.

## Development

```sh
npm run hub:dev                    # hub with reload (stop the launchd one first)
npm run watch -w extension         # rebuild extension on change, then click "reload" in chrome://extensions
npm run typecheck -w hub && npm run typecheck -w extension
```

## License

MIT
