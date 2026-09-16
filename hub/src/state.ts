import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Block = {
  i: number;
  tag: string;
  heading: string[]; // h1 > h2 > ... path this block sits under
  text: string;
};

export type PageMsg = {
  type: "page";
  url: string;
  title: string;
  blocks: Block[];
};

export type Selection = { text: string; block: number } | null;

export type ViewMsg = {
  type: "view";
  url: string;
  visible: [number, number] | null; // inclusive block index range
  selection: Selection;
  scrollPct: number;
};

export type PageInfo = { url: string; title: string; blocks: Block[]; receivedAt: number };
export type View = Omit<ViewMsg, "type"> & { updatedAt: number };

export const STATE_DIR = process.env.READING_BUDDY_STATE_DIR ?? join(homedir(), ".local", "state", "reading-buddy");
export const NOTES_DIR = join(STATE_DIR, "notes");
const CURRENT_FILE = join(STATE_DIR, "current.json");
const MAX_PAGES = 50;

// One entry per URL. Insertion order is refreshed on every update so the Map
// doubles as an LRU: the last entry is the page most recently looked at.
const pages = new Map<string, PageInfo>();
const views = new Map<string, View>();

function touch<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_PAGES) map.delete(map.keys().next().value!);
}

export function ingest(msg: PageMsg | ViewMsg): void {
  if (msg.type === "page") {
    touch(pages, msg.url, { url: msg.url, title: msg.title, blocks: msg.blocks, receivedAt: Date.now() });
    if (!views.has(msg.url)) touch(views, msg.url, { url: msg.url, visible: null, selection: null, scrollPct: 0, updatedAt: Date.now() });
  } else {
    touch(views, msg.url, { url: msg.url, visible: msg.visible, selection: msg.selection, scrollPct: msg.scrollPct, updatedAt: Date.now() });
  }
  scheduleDump();
}

/** Most recently updated view whose URL contains `filter` (case-insensitive). No filter = most recent overall. */
export function snapshot(filter?: string): { page: PageInfo | null; view: View | null } {
  const needle = filter?.trim().toLowerCase();
  const ordered = [...views.values()].reverse();
  const view = ordered.find((v) => !needle || v.url.toLowerCase().includes(needle) || pages.get(v.url)?.title.toLowerCase().includes(needle)) ?? null;
  const page = view ? pages.get(view.url) ?? null : null;
  return { page, view };
}

export function hasPage(url: string): boolean {
  return pages.has(url);
}

export function listPages(): { url: string; title: string; scrollPct: number; updatedAt: number }[] {
  return [...views.values()]
    .reverse()
    .map((v) => ({ url: v.url, title: pages.get(v.url)?.title ?? "", scrollPct: v.scrollPct, updatedAt: v.updatedAt }));
}

let dumpTimer: NodeJS.Timeout | null = null;
function scheduleDump() {
  if (dumpTimer) return;
  dumpTimer = setTimeout(() => {
    dumpTimer = null;
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(CURRENT_FILE, JSON.stringify({ current: snapshot().view, pages: listPages() }, null, 2));
    } catch {
      /* best effort */
    }
  }, 500);
}
