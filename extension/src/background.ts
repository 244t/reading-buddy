// Background worker: forwards reports from the content script to the local hub.
// Rule: only the active tab of the most recently focused window counts as "what the
// user is reading". Switching tabs/windows asks the new tab to resend its state.

const HUB = "http://127.0.0.1:8737/state";

function badge(ok: boolean) {
  chrome.action.setBadgeText({ text: ok ? "on" : "off" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e7d32" : "#9e9e9e" }).catch(() => {});
}

async function focusedTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function askResend() {
  const id = await focusedTabId();
  if (id == null) return;
  chrome.tabs.sendMessage(id, { type: "resend" }).catch(() => {});
}

chrome.tabs.onActivated.addListener(() => void askResend());
chrome.windows.onFocusChanged.addListener((w) => {
  if (w !== chrome.windows.WINDOW_ID_NONE) void askResend();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  void (async () => {
    if (tabId !== (await focusedTabId())) return;
    try {
      const r = await fetch(HUB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
      badge(r.ok);
      // Hub lost the page (restart): ask this tab to resend its blocks.
      const body = (await r.json().catch(() => null)) as { needPage?: boolean } | null;
      if (body?.needPage) chrome.tabs.sendMessage(tabId, { type: "resend" }).catch(() => {});
    } catch {
      badge(false);
    }
  })();
});

badge(false);
