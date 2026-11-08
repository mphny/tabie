// Tabie background script.
// Runs as a service worker in Chromium browsers and as an event page in Firefox.
const api = globalThis.browser ?? globalThis.chrome;

// No badge on the toolbar icon. Clear any tab count left by older versions.
function clearBadge() {
  api.action.setBadgeText({ text: "" }).catch(() => {});
}

async function focusTab(tab) {
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(tab.windowId, { focused: true });
}

async function jumpToPreviousTab() {
  const tabs = await api.tabs.query({});
  const [current] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  const previous = tabs
    .filter((t) => !current || t.id !== current.id)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (previous) await focusTab(previous);
}

// ---------- tab previews ----------
// Browsers can only screenshot the visible tab of a window, so previews are
// captured opportunistically whenever you look at a tab. Background and
// sleeping tabs are never activated or reloaded just to get a preview.

const THUMB_PREFIX = "thumb:";
const THUMB_WIDTH = 360;
const MAX_THUMBS = 300;
let capturesSincePrune = 0;

function thumbKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return THUMB_PREFIX + u.href;
  } catch {
    return THUMB_PREFIX + url;
  }
}

async function resize(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(Math.min(bitmap.height * scale, w * 0.75));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, Math.round(bitmap.height * scale));
  bitmap.close?.();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return "data:image/jpeg;base64," + btoa(bin);
}

async function captureActive(windowId) {
  try {
    const [tab] = await api.tabs.query({ active: true, windowId });
    if (!tab || tab.status !== "complete" || !/^(https?|file):/.test(tab.url || "")) return;
    if (tab.incognito) return;
    const shot = await api.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
    // Make sure the user didn't switch tabs while we were capturing.
    const [still] = await api.tabs.query({ active: true, windowId });
    if (!still || still.id !== tab.id || still.url !== tab.url) return;
    const img = await resize(shot);
    await api.storage.local.set({ [thumbKey(tab.url)]: { img, t: Date.now() } });
    if (++capturesSincePrune >= 25) pruneThumbs();
  } catch {
    // Missing host permission, minimized window, protected page, or rate limit.
  }
}

// Debounce per window: wait for the page to settle, and stay under the
// browser's captureVisibleTab rate limit.
const captureTimers = new Map();
function scheduleCapture(windowId, delay = 700) {
  if (windowId == null || windowId < 0) return;
  clearTimeout(captureTimers.get(windowId));
  captureTimers.set(windowId, setTimeout(() => {
    captureTimers.delete(windowId);
    captureActive(windowId);
  }, delay));
}

async function pruneThumbs() {
  capturesSincePrune = 0;
  const all = await api.storage.local.get(null);
  const open = new Set((await api.tabs.query({})).filter((t) => !t.incognito).map((t) => thumbKey(t.url)));
  // Shortcuts (bookmarks in the Tabie folder) keep their preview while closed.
  try {
    if (all.shortcutsFolderId) {
      for (const b of await api.bookmarks.getChildren(all.shortcutsFolderId)) if (b.url) open.add(thumbKey(b.url));
    }
  } catch {
    // folder gone or bookmarks unavailable
  }
  const thumbs = Object.entries(all)
    .filter(([k]) => k.startsWith(THUMB_PREFIX))
    .sort((a, b) => (b[1]?.t ?? 0) - (a[1]?.t ?? 0));
  // Only pages that are open right now (or saved as Shortcuts) keep a preview.
  // Anything closed, navigated away from or removed from history is deleted.
  const stale = thumbs.filter(([k]) => !open.has(k)).map(([k]) => k);
  const overflow = thumbs.filter(([k]) => open.has(k)).slice(MAX_THUMBS).map(([k]) => k);
  if (stale.length || overflow.length) await api.storage.local.remove([...stale, ...overflow]);
}

// Delete previews as soon as their page is gone: tab closed, tab navigated to
// another page, or the page removed from browser history (incl. Clear history).
let sweepTimer;
function scheduleSweep() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => pruneThumbs().catch(() => {}), 400);
}
api.tabs.onRemoved.addListener(scheduleSweep);
api.tabs.onUpdated.addListener((_id, info) => {
  if (info.url) scheduleSweep();
});
api.history?.onVisitRemoved?.addListener(scheduleSweep);
api.bookmarks?.onRemoved?.addListener(scheduleSweep);

api.tabs.onActivated.addListener(({ windowId }) => scheduleCapture(windowId));
api.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === "complete" || info.title)) scheduleCapture(tab.windowId, 1000);
});
api.windows.onFocusChanged.addListener((windowId) => scheduleCapture(windowId));

// ---------- manager tab ----------
// The toolbar button opens Tabie as a normal tab (a popup would close every
// time the active tab changes). Reuse the existing Tabie tab if there is one.
// Tabie is pinned and kept as the very first tab: browsers always keep pinned
// tabs ahead of the rest, so pinning is what lets it stay first.

// Tabie also replaces the New Tab page (chrome_url_overrides), so the pinned
// tab gets its own "?tab" URL. Otherwise every new tab would be pinned and moved.
const managerBase = api.runtime.getURL("popup.html?tab");
const isManager = (t) => (t.url || t.pendingUrl || "").startsWith(managerBase);

async function openManager(windowId) {
  const tabs = await api.tabs.query({});
  const mine = tabs.filter(isManager);
  const existing = mine.find((t) => t.windowId === windowId) ?? mine[0];
  if (existing) {
    await api.tabs.update(existing.id, { active: true });
    await api.windows.update(existing.windowId, { focused: true });
    keepManagerFirst();
  } else {
    await api.tabs.create({ url: managerBase, windowId, index: 0, pinned: true });
  }
}

// Move the first Tabie tab of each window back to the first position. Extra
// manager tabs are only pinned: moving them too would just trade places with
// the first one and retrigger this via onMoved forever.
async function keepManagerFirst(attempt = 0) {
  try {
    const tabs = (await api.tabs.query({})).filter(isManager);
    const firstPerWindow = new Map();
    for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
      if (!firstPerWindow.has(t.windowId)) firstPerWindow.set(t.windowId, t);
      if (!t.pinned) await api.tabs.update(t.id, { pinned: true });
    }
    for (const t of firstPerWindow.values()) {
      if (t.index !== 0) await api.tabs.move(t.id, { index: 0 });
    }
  } catch {
    // Chrome refuses to move tabs while the user is still dragging one; retry shortly.
    if (attempt < 5) setTimeout(() => keepManagerFirst(attempt + 1), 400);
  }
}

let firstTimer;
function scheduleKeepFirst() {
  clearTimeout(firstTimer);
  firstTimer = setTimeout(() => keepManagerFirst(), 250);
}

api.tabs.onMoved.addListener(scheduleKeepFirst);
api.tabs.onAttached.addListener(scheduleKeepFirst);
api.tabs.onCreated.addListener(scheduleKeepFirst);
api.tabs.onUpdated.addListener((_id, info, tab) => {
  if ("pinned" in info || (info.url && isManager(tab))) scheduleKeepFirst();
});

// Serialize opens: two quick clicks would otherwise both query before either
// create lands and end up with two Tabie tabs in the window.
let managerQueue = Promise.resolve();
api.action.onClicked.addListener((tab) => {
  managerQueue = managerQueue.then(() => openManager(tab?.windowId)).catch(() => {});
});

api.commands.onCommand.addListener((command, tab) => {
  if (command === "previous-tab") jumpToPreviousTab();
  // Called without awaiting anything first, so it still counts as a user gesture.
  if (command === "open-side-panel" && api.sidePanel && tab) {
    api.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

api.runtime.onInstalled.addListener(clearBadge);
api.runtime.onStartup.addListener(() => {
  clearBadge();
  pruneThumbs();
});
clearBadge();
