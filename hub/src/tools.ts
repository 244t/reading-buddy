import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NOTES_DIR, listPages, snapshot, type Block, type PageInfo } from "./state.js";

const DEFAULT_MAX_CHARS = 6000; // roughly 1500 tokens

const bookParam = z
  .string()
  .optional()
  .describe(
    "Substring of the URL or title of the book/page to use (case-insensitive), e.g. 'sre-book'. " +
      "Use it when this session is dedicated to one book so other tabs do not interfere. Omit for the tab the user looked at most recently.",
  );

function fmtBlock(b: Block): string {
  const prefix = b.tag.startsWith("h") ? "#".repeat(Number(b.tag[1]) || 1) + " " : b.tag === "li" ? "- " : "";
  return `[${b.i}] ${prefix}${b.text}`;
}

function trimBlocks(blocks: Block[], maxChars: number): { text: string; truncated: number } {
  const lines: string[] = [];
  let used = 0;
  let truncated = 0;
  for (const b of blocks) {
    const line = fmtBlock(b);
    if (used + line.length > maxChars && lines.length > 0) {
      truncated++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join("\n"), truncated };
}

function notReading(filter?: string): string {
  if (filter) {
    const known = listPages().map((p) => `- ${p.url}`).join("\n");
    return `No page matching "${filter}" has been seen. Known pages:\n${known || "(none)"}`;
  }
  return "No page is being read right now. The browser extension has not reported anything yet (is the extension loaded and the tab reloaded after installing it?).";
}

function readingNow(maxChars: number, book?: string): string {
  const { page, view } = snapshot(book);
  if (!page || !view) return notReading(book);

  const out: string[] = [];
  out.push(`URL: ${page.url}`);
  out.push(`Title: ${page.title}`);

  const topIdx = view.visible ? view.visible[0] : 0;
  const top = page.blocks[topIdx];
  if (top?.heading.length) out.push(`Section: ${top.heading.join(" > ")}`);
  if (view.visible) {
    out.push(`Position: ${Math.round(view.scrollPct)}% (blocks ${view.visible[0]}-${view.visible[1]} of ${page.blocks.length})`);
  }

  if (view.selection?.text) {
    out.push("", "## Selected by the user (the thing they are most likely asking about)", `> ${view.selection.text.replace(/\n/g, "\n> ")}`);
    const b = page.blocks[view.selection.block];
    if (b) {
      const prev = page.blocks[view.selection.block - 1];
      const next = page.blocks[view.selection.block + 1];
      out.push("", "Containing block with neighbours:");
      if (prev) out.push(fmtBlock(prev));
      out.push(fmtBlock(b));
      if (next) out.push(fmtBlock(next));
    }
  }

  if (view.visible) {
    const [a, z] = view.visible;
    const vis = page.blocks.slice(a, z + 1);
    const { text, truncated } = trimBlocks(vis, maxChars);
    out.push("", "## Visible on screen", text);
    if (truncated) out.push(`(… ${truncated} more visible blocks omitted; call reading_section for the full text)`);
  }
  return out.join("\n");
}

function sectionOf(page: PageInfo, heading: string | undefined, fallbackIdx: number): Block[] {
  let path: string[] | null = null;
  if (heading) {
    const needle = heading.toLowerCase();
    const hit = page.blocks.find((b) => b.tag.startsWith("h") && b.text.toLowerCase().includes(needle));
    if (hit) path = [...hit.heading, hit.text];
    else return [];
  } else {
    path = page.blocks[fallbackIdx]?.heading ?? [];
    if (path.length === 0) return page.blocks; // page has no headings
  }
  const key = path.join("\u001f");
  return page.blocks.filter((b) => {
    const h = b.heading.join("\u001f");
    // block is under the section if its heading path starts with the section path,
    // or it *is* the heading block itself.
    return h === key || h.startsWith(key + "\u001f") || (b.tag.startsWith("h") && [...b.heading, b.text].join("\u001f") === key);
  });
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "reading_now",
    {
      title: "What the user is reading right now",
      description:
        "Returns the web page, section, text currently visible in the user's browser, and any text they have selected. " +
        "ALWAYS call this first when the user asks about 'this sentence', 'this paragraph', 'here', a word, or anything " +
        "that refers to what they are reading, before answering. Cheap: one call, ~1-2k tokens.",
      inputSchema: {
        book: bookParam,
        maxChars: z.number().int().min(500).max(40000).optional().describe(`Cap on visible text length. Default ${DEFAULT_MAX_CHARS}.`),
      },
    },
    async ({ book, maxChars }) => ({ content: [{ type: "text", text: readingNow(maxChars ?? DEFAULT_MAX_CHARS, book) }] }),
  );

  server.registerTool(
    "reading_section",
    {
      title: "Full text of a section of the current page",
      description:
        "Returns every block under a heading of the page currently being read. Without `heading`, uses the section the user is currently looking at. " +
        "Use for questions that span more than what is on screen (summaries, 'what did the author mean earlier').",
      inputSchema: {
        book: bookParam,
        heading: z.string().optional().describe("Substring of a heading on the page (case-insensitive). Omit for the current section."),
        maxChars: z.number().int().min(500).max(80000).optional().describe("Cap on returned text length. Default 20000."),
      },
    },
    async ({ book, heading, maxChars }) => {
      const { page, view } = snapshot(book);
      if (!page || !view) return { content: [{ type: "text", text: notReading(book) }] };
      const idx = view.visible ? view.visible[0] : 0;
      const blocks = sectionOf(page, heading, idx);
      if (blocks.length === 0) return { content: [{ type: "text", text: `No heading matching "${heading}" on ${page.url}.` }] };
      const { text, truncated } = trimBlocks(blocks, maxChars ?? 20000);
      const head = `URL: ${page.url}\nTitle: ${page.title}\n\n`;
      return { content: [{ type: "text", text: head + text + (truncated ? `\n(… ${truncated} blocks omitted; raise maxChars)` : "") }] };
    },
  );

  server.registerTool(
    "reading_note",
    {
      title: "Save a reading note",
      description:
        "Append a note (a conclusion of the discussion, a vocabulary item, a question to revisit) to the user's notes file for the current page. " +
        "The current URL and selected text are recorded automatically. Use when the user says 'メモして', 'note this', or when a discussion reaches a useful conclusion and the user agrees to save it.",
      inputSchema: {
        book: bookParam,
        text: z.string().min(1).describe("The note body, in the user's language. Markdown allowed."),
      },
    },
    async ({ book, text }) => {
      const { page, view } = snapshot(book);
      mkdirSync(NOTES_DIR, { recursive: true });
      const slug = page ? page.url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) : "no-page";
      const file = join(NOTES_DIR, `${slug}.md`);
      const parts = [`## ${new Date().toISOString()}`];
      if (page) parts.push(`- url: ${page.url}`, `- title: ${page.title}`);
      if (view?.selection?.text) parts.push(`- quote: "${view.selection.text}"`);
      parts.push("", text, "");
      appendFileSync(file, parts.join("\n") + "\n");
      return { content: [{ type: "text", text: `Saved to ${file}` }] };
    },
  );

  server.registerTool(
    "reading_list",
    {
      title: "Pages the user has been reading",
      description: "Lists pages seen by the extension, most recent first, with reading progress. Use to find the right `book` filter or to ask which book the user means.",
      inputSchema: {},
    },
    async () => {
      const rows = listPages().map((p) => `- ${p.title || "(untitled)"} — ${p.url} (${Math.round(p.scrollPct)}%, ${new Date(p.updatedAt).toISOString()})`);
      return { content: [{ type: "text", text: rows.join("\n") || "(no pages seen yet)" }] };
    },
  );
}
