// Content script: extracts the page's text blocks once, then reports which blocks are
// visible and what text is selected. Everything goes to the background worker, which
// forwards to the local hub. Nothing leaves the machine.

type Block = { i: number; tag: string; heading: string[]; text: string };

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,dt,dd,figcaption";
const CONTAINER_TAGS = new Set(["LI", "TD", "TH", "DD", "BLOCKQUOTE"]);
const SKIP_ANCESTOR = "nav,header,footer,aside,script,style,noscript,[aria-hidden='true']";
const ATTR = "data-rb-i";

let elements: HTMLElement[] = [];
let blocks: Block[] = [];
let currentUrl = "";
const visibleSet = new Set<number>();
let observer: IntersectionObserver | null = null;
let lastViewJson = "";

function send(msg: unknown) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    /* extension reloaded; page needs refresh */
  }
}

function extract(): Block[] {
  const blocks: Block[] = [];
  const headingStack: { level: number; text: string }[] = [];
  elements = [];
  const nodes = document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  for (const el of nodes) {
    if (el.closest(SKIP_ANCESTOR)) continue;
    // Containers that themselves hold block children are represented by their children.
    if (CONTAINER_TAGS.has(el.tagName) && el.querySelector("p,pre,li,blockquote")) continue;
    // Table cells with block children are also skipped above. A <p> inside <li> is kept.
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      const i = blocks.length;
      blocks.push({ i, tag, heading: headingStack.map((h) => h.text), text });
      headingStack.push({ level, text });
    } else {
      blocks.push({ i: blocks.length, tag, heading: headingStack.map((h) => h.text), text });
    }
    el.setAttribute(ATTR, String(blocks.length - 1));
    elements.push(el);
  }
  return blocks;
}

function scrollPct(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  return max <= 0 ? 100 : Math.min(100, Math.max(0, (window.scrollY / max) * 100));
}

function currentSelection(): { text: string; block: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (!text) return null;
  let node: Node | null = sel.anchorNode;
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const owner = el?.closest<HTMLElement>(`[${ATTR}]`);
  const block = owner ? Number(owner.getAttribute(ATTR)) : -1;
  return { text: text.slice(0, 4000), block };
}

function sendView() {
  let visible: [number, number] | null = null;
  if (visibleSet.size) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of visibleSet) {
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
    visible = [lo, hi];
  }
  const msg = { type: "view", url: currentUrl, visible, selection: currentSelection(), scrollPct: scrollPct() };
  const j = JSON.stringify(msg);
  if (j === lastViewJson) return;
  lastViewJson = j;
  send(msg);
}

let viewTimer: number | null = null;
function scheduleView(delay = 300) {
  if (viewTimer !== null) window.clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => {
    viewTimer = null;
    sendView();
  }, delay);
}

function sendPage() {
  send({ type: "page", url: currentUrl, title: document.title, blocks });
}

// The background worker asks for this when this tab becomes the focused one.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "resend") {
    sendPage();
    lastViewJson = "";
    scheduleView(50);
  }
});

function init() {
  currentUrl = location.href;
  lastViewJson = "";
  visibleSet.clear();
  observer?.disconnect();

  blocks = extract();
  sendPage();

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const i = Number((e.target as HTMLElement).getAttribute(ATTR));
        if (e.isIntersecting) visibleSet.add(i);
        else visibleSet.delete(i);
      }
      scheduleView();
    },
    { threshold: 0 },
  );
  for (const el of elements) observer.observe(el);
  scheduleView(100);
}

document.addEventListener("selectionchange", () => scheduleView());
window.addEventListener("scroll", () => scheduleView(), { passive: true });
window.addEventListener("focus", () => scheduleView(50));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    lastViewJson = ""; // force a resend so the hub switches to this tab
    scheduleView(50);
  }
});

// SPA navigation / hash changes: re-extract when the URL changes.
window.setInterval(() => {
  if (location.href !== currentUrl) init();
}, 1000);

init();
