// Tabie page: search, navigate and manage tabs across all windows.
// Runs as a full browser tab, or in the side panel (popup.html?panel).
const api = globalThis.browser ?? globalThis.chrome;

const PREFS_KEY = "prefs";
const STARRED_KEY = "starred"; // old storage of stars, moved into bookmarks once
const SHORTCUTS_FOLDER = "Tabie Shortcuts";
const SHORTCUTS_FOLDER_KEY = "shortcutsFolderId";
const RECENT_SEARCHES_KEY = "recentSearches";
const THUMB_PREFIX = "thumb:";
const SORTS = ["recent", "newest", "oldest", "az"];

// Default search engine: where "Search …" goes and where suggestions come from.
const ENGINES = {
  google: {
    name: "Google",
    site: "google.com",
    search: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    suggest: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`,
  },
  bing: {
    name: "Bing",
    site: "bing.com",
    search: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    suggest: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
  },
  duckduckgo: {
    name: "DuckDuckGo",
    site: "duckduckgo.com",
    search: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    suggest: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
  },
  // AI assistants as the default: Enter asks them (see AI_ASSISTANTS), and
  // suggestions come from Google.
  chatgpt: { name: "ChatGPT", site: "chatgpt.com", verb: "Ask", ai: "ChatGPT" },
  gemini: { name: "Gemini", site: "gemini.google.com", verb: "Ask", ai: "Gemini" },
};
const engine = () => ENGINES[state.engine] ?? ENGINES.google;
// "Search Google" / "Ask ChatGPT"
const engineVerb = () => `${engine().verb ?? "Search"} ${engine().name}`;
const GROUPS = ["none", "site"]; // a saved "window" choice falls back to none

const inPanel = new URLSearchParams(location.search).has("panel");

// Appearance: "auto" follows the system; "light"/"dark" force it. A copy is kept
// in localStorage so the right theme applies before the first paint.
const THEMES = ["auto", "light", "dark"];
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll("[data-theme-choice]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.themeChoice === (theme || "auto"))));
  try {
    localStorage.setItem("tabie-theme", theme || "auto");
  } catch {
    // storage blocked; the synced pref below still applies
  }
}
try {
  applyTheme(localStorage.getItem("tabie-theme") || "auto");
} catch {
  // ignore
}
const selfBase = api.runtime.getURL("popup.html");

const state = {
  query: "",
  sort: "recent",
  group: "none",
  layout: "cards", // "cards" | "list"
  starsOpen: false, // Shortcuts sheet that slides in from the right
  historyOpen: false, // History sheet that slides in from the left
  historyTab: "history", // "history" (browser history) | "closed" (recently closed)
  historyItems: [], // browser history for the sheet (history API)
  historyResults: { q: "", items: [] }, // browser history matching the search
  downloadsOpen: false, // Downloads sheet that slides in from the right
  downloads: [], // browser download history (downloads API)
  theme: "auto",
  engine: "google", // default search engine (ENGINES)
  tabs: [],
  windows: [],
  closed: [], // recently closed tabs/windows from the sessions API
  starred: new Map(), // Shortcuts: normalized URL -> bookmark { id, url, title }
  thumbs: {}, // thumbKey -> { img, t }, captured by background.js
  selected: new Set(),
  cursor: 0, // index into state.items
  items: [], // navigable entries in render order: { kind: "tab" | "closed" | "search", id }
  currentWindowId: null,
  currentTabId: null,
  selfTabId: null, // Tabie's own tab; never listed, so nothing can close it
};

// Ignore clicks that land on a card right after a close: the grid shifts and
// the next card slides under the mouse, so a double-click would open it.
let quietUntil = 0;

const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const queryEl = $("#q");

const ICON = {
  star: '<svg viewBox="0 0 16 16"><path d="m8 1.3 2 4.3 4.7.5-3.5 3.2 1 4.6L8 11.5l-4.2 2.4 1-4.6L1.3 6.1 6 5.6z"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="m4.2 3 3.8 3.8L11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>',
  pin: '<svg viewBox="0 0 16 16"><path d="M10.2 1.2 14.8 5.8l-1.4 1.4-.7-.3-2.6 2.6.4 3.1-1.4 1.4-2.8-2.8-3.6 3.6-1-1 3.6-3.6-2.8-2.8 1.4-1.4 3.1.4 2.6-2.6-.3-.7z"/></svg>',
  sound: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2zm9.5-1.2 1-1a6 6 0 0 1 0 8.4l-1-1a4.6 4.6 0 0 0 0-6.4z"/></svg>',
  muted: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2zm9.3-.3L13 7.4l1.7-1.7.8.8-1.7 1.7 1.7 1.7-.8.8L13 9l-1.7 1.7-.8-.8 1.7-1.7-1.7-1.7z"/></svg>',
  restore: '<svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 1-5.7 7.9l1.9-.6A4 4 0 1 0 5.2 5H7v2H2V2h2v1.6A6 6 0 0 1 8 2z"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M6 1h4l.6 1.2H14v1.6H2V2.2h3.4zM3.2 5h9.6l-.7 9.1A1.6 1.6 0 0 1 10.5 15.6h-5a1.6 1.6 0 0 1-1.6-1.5zm2.6 1.6.3 7.2h1.3L7.1 6.6zm3.1 0-.3 7.2h1.3l.3-7.2z"/></svg>',
  bookmark: '<svg viewBox="0 0 16 16"><path d="M4 1.5h8A1.5 1.5 0 0 1 13.5 3v12L8 11.6 2.5 15V3A1.5 1.5 0 0 1 4 1.5z"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M4 1h5.5L13 4.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 1.2V5h2.8z"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.4l1.5 1.7H13A1.5 1.5 0 0 1 14.5 4.7V12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M4 2.5h2.5v11H4zm5.5 0H12v11H9.5z"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.3 13 8l-8.5 5.7z"/></svg>',
  retry: '<svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 1-5.7 7.9l1.9-.6A4 4 0 1 0 5.2 5H7v2H2V2h2v1.6A6 6 0 0 1 8 2z"/></svg>',
  broom: '<svg viewBox="0 0 16 16"><path d="M13.3.8a1.1 1.1 0 0 1 1.6 1.6L10.6 6.7l.6.6a1 1 0 0 1 0 1.4l-.6.6-4.4-4.4.6-.6a1 1 0 0 1 1.4 0l.6.6zM5.5 5.6l4.5 4.5-.5 2a2.5 2.5 0 0 1-1.1 1.5L4.2 16l1.6-2.9-.7-.7-2.5 1.8.7-2.1-.9-.9-2.2.7L2 9.4a2.6 2.6 0 0 1 1.5-1.2z"/></svg>',
  sort: '<svg viewBox="0 0 16 16"><path d="M4.5 2 7.5 5.5H5.25V14h-1.5V5.5H1.5zm7 12-3-3.5h2.25V2h1.5v8.5h2.25z"/></svg>',
  newWindow: '<svg viewBox="0 0 16 16"><path d="M9 1.5h5.5V7H13V4.06L8.28 8.78 7.22 7.72 11.94 3H9zM2.5 3H7v1.5H3v8.5h8.5V9H13v4.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>',
  windows: '<svg viewBox="0 0 16 16"><path d="M4 1.5h9.5A1.5 1.5 0 0 1 15 3v7a1.5 1.5 0 0 1-1.5 1.5H12V13a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 1 13V6a1.5 1.5 0 0 1 1.5-1.5h1V3A1.5 1.5 0 0 1 4 1.5zm0 3h6.5A1.5 1.5 0 0 1 12 6v4h1.5V3H4z"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 1.5a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm-.75 1.5h1.5v3.2l2.3 1.3-.75 1.3-3.05-1.75z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>',
  moon: '<svg viewBox="0 0 16 16"><path d="M9.5 1.5a6.5 6.5 0 1 0 5 9.9 5.5 5.5 0 0 1-5-9.9z"/></svg>',
};

// ---------- helpers ----------

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return "Local files";
    if (!/^(https?|ftp):$/.test(u.protocol)) return "Browser pages";
    return u.hostname.replace(/^www\./, "") || u.protocol.replace(":", "");
  } catch {
    return "other";
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url || "";
  }
}

// Must match thumbKey() in background.js.
function thumbKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return THUMB_PREFIX + u.href;
  } catch {
    return THUMB_PREFIX + url;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Tint for letter icons and preview placeholders. Picked from a fixed set of
// hues so it never lands on purple or pink.
const HUES = [0, 18, 32, 45, 140, 160, 175, 190, 200, 212];
function colorFor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${HUES[h % HUES.length]} 55% 45%)`;
}

function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// Favicon URLs that failed to load; they render as the letter from then on.
const brokenFavicons = new Set();

function favicon(url, favIconUrl, label) {
  const host = hostOf(url);
  const letter = escapeHtml(((label || host)[0] || "?").toUpperCase());
  const color = colorFor(host);
  return favIconUrl && !brokenFavicons.has(favIconUrl) && /^(https?|data|chrome-extension|moz-extension):/.test(favIconUrl)
    ? `<span class="fav"><img src="${escapeHtml(favIconUrl)}" alt="" data-letter="${letter}" data-color="${color}"></span>`
    : `<span class="fav" style="background:${color}">${letter}</span>`;
}

// ---------- search ----------

const queryTerms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);

// Every term must appear in the title or URL. A single word also gets a fuzzy
// subsequence match on the title, so "gthb" still finds GitHub.
function match(title, url, terms) {
  if (!terms.length) return { score: 0, terms };
  const t = (title || "").toLowerCase();
  const u = (url || "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    const ti = t.indexOf(term);
    const ui = u.indexOf(term);
    if (ti === -1 && ui === -1) return fuzzy(t, terms);
    if (ti === 0) score += 30;
    else if (ti > 0) score += /\W/.test(t[ti - 1]) ? 20 : 12;
    if (ui !== -1) score += hostOf(url).includes(term) ? 15 : 5;
  }
  return { score, terms };
}

function fuzzy(title, terms) {
  if (terms.length !== 1 || terms[0].length < 2) return null;
  const needle = terms[0];
  let i = 0;
  for (const ch of title) if (ch === needle[i]) i++;
  return i === needle.length ? { score: 1, terms: [] } : null;
}

function highlight(text, terms) {
  const safe = escapeHtml(text);
  if (!terms.length) return safe;
  const pattern = terms
    .map((t) => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

// ---------- data ----------

const isSelf = (url) => (url || "").startsWith(selfBase);

async function loadTabs() {
  const [tabs, windows, current, closed] = await Promise.all([
    api.tabs.query({}),
    api.windows.getAll(),
    api.windows.getCurrent(),
    api.sessions?.getRecentlyClosed?.({ maxResults: 25 }).catch(() => []) ?? [],
  ]);

  state.tabs = tabs.filter((t) => t.id !== state.selfTabId && !isSelf(t.url));
  state.windows = windows.filter((w) => w.type === "normal" || w.type === undefined);
  state.currentWindowId = current.id;
  // When Tabie itself is the active tab, "current" means the tab you came from.
  const inWindow = state.tabs.filter((t) => t.windowId === current.id);
  state.currentTabId = (inWindow.find((t) => t.active) ??
    [...inWindow].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0])?.id ?? null;

  state.closed = (closed || [])
    .map((c) => {
      // lastModified is seconds in Chrome and milliseconds in Firefox.
      const when = c.lastModified < 1e12 ? c.lastModified * 1000 : c.lastModified;
      if (c.tab) {
        return {
          sid: c.tab.sessionId, kind: "tab", when,
          title: c.tab.title || c.tab.url, url: c.tab.url, favIconUrl: c.tab.favIconUrl,
        };
      }
      if (c.window) {
        const first = c.window.tabs?.[0] ?? {};
        return {
          sid: c.window.sessionId, kind: "window", when,
          title: `Window · ${plural(c.window.tabs?.length ?? 0, "tab")}`,
          url: first.url, favIconUrl: first.favIconUrl,
          sub: (c.window.tabs || []).map((t) => t.title).slice(0, 3).join(", "),
        };
      }
      return null;
    })
    .filter((c) => c && c.sid && !isSelf(c.url));

  for (const id of state.selected) {
    if (!state.tabs.some((t) => t.id === id)) state.selected.delete(id);
  }
  await loadDownloads();

  // Previews come from storage only; tabs are never loaded to make one.
  const keys = [...new Set([...state.tabs, ...state.closed].map((t) => thumbKey(t.url)))];
  state.thumbs = keys.length ? await api.storage.local.get(keys) : {};
}

// ---------- shortcuts (stored as real bookmarks) ----------
// Starring a tab saves it as a browser bookmark in a "Tabie Shortcuts" folder,
// so shortcuts survive reloads, reinstalls and restarts, sync with the browser
// account, and also show up in the browser's own Favorites/Bookmarks.

let shortcutsFolderId = null;

async function getShortcutsFolder() {
  if (shortcutsFolderId) {
    try {
      await api.bookmarks.get(shortcutsFolderId);
      return shortcutsFolderId;
    } catch {
      shortcutsFolderId = null; // folder was deleted
    }
  }
  const cached = (await api.storage.local.get(SHORTCUTS_FOLDER_KEY))[SHORTCUTS_FOLDER_KEY];
  if (cached) {
    try {
      const [node] = await api.bookmarks.get(cached);
      if (node && !node.url) return (shortcutsFolderId = node.id);
    } catch {
      // stale id
    }
  }
  const found = (await api.bookmarks.search({ title: SHORTCUTS_FOLDER })).find((n) => !n.url);
  // Without a parentId the browser picks "Other bookmarks" / "Other favorites".
  const folder = found ?? (await api.bookmarks.create({ title: SHORTCUTS_FOLDER }));
  shortcutsFolderId = folder.id;
  await api.storage.local.set({ [SHORTCUTS_FOLDER_KEY]: folder.id });
  return folder.id;
}

async function loadStarred() {
  const next = new Map();
  if (api.bookmarks) {
    try {
      const folderId = await getShortcutsFolder();
      await migrateOldStars(folderId);
      for (const b of await api.bookmarks.getChildren(folderId)) {
        if (b.url) next.set(normalizeUrl(b.url), { id: b.id, url: b.url, title: b.title });
      }
    } catch {
      // bookmarks unavailable: Starred view is just empty
    }
  }
  state.starred = next;
}

// Stars from older versions lived in extension storage; move them into the
// bookmarks folder once so nothing is lost, then drop the old copy.
async function migrateOldStars(folderId) {
  const old = (await api.storage.local.get(STARRED_KEY))[STARRED_KEY];
  if (!Array.isArray(old) || !old.length) return;
  const existing = new Set((await api.bookmarks.getChildren(folderId)).map((b) => normalizeUrl(b.url)));
  for (const item of old) {
    const url = typeof item === "string" ? item : item?.url;
    if (!url || existing.has(normalizeUrl(url))) continue;
    const tab = state.tabs.find((t) => normalizeUrl(t.url) === normalizeUrl(url));
    await api.bookmarks.create({ parentId: folderId, title: tab?.title || hostOf(url), url }).catch(() => {});
  }
  await api.storage.local.remove(STARRED_KEY);
}

const isStarred = (url) => state.starred.has(normalizeUrl(url));

// Favicon for a shortcut that isn't open: its tab's icon if we have one,
// otherwise the browser's favicon cache (Chromium).
function shortcutIcon(url) {
  const tab = state.tabs.find((t) => normalizeUrl(t.url) === normalizeUrl(url));
  if (tab?.favIconUrl) return tab.favIconUrl;
  if (!globalThis.browser && api.runtime?.getURL) {
    return api.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
  }
  return "";
}

// Shortcuts whose page isn't open in any tab right now.
function closedShortcuts(terms) {
  const open = new Set(state.tabs.map((t) => normalizeUrl(t.url)));
  return [...state.starred.entries()]
    .filter(([key]) => !open.has(key))
    .map(([key, b]) => ({ ...b, key, m: match(b.title || b.url, b.url, terms) }))
    .filter((b) => b.m)
    .sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url))
    .map((b) => ({ ...b, terms: b.m.terms }));
}

function sortTabs(list, searching) {
  const byTitle = (a, b) => (a.tab.title || "").localeCompare(b.tab.title || "");
  const sorters = {
    recent: (a, b) => (b.tab.lastAccessed ?? 0) - (a.tab.lastAccessed ?? 0),
    newest: (a, b) => b.tab.id - a.tab.id, // tab ids increase as tabs are opened
    oldest: (a, b) => a.tab.id - b.tab.id,
    az: byTitle,
  };
  const by = sorters[state.sort] ?? sorters.recent;
  return list.sort((a, b) => (searching ? b.score - a.score : 0) || by(a, b));
}

// ---------- rendering ----------

// On the empty screen the whole toolbar slides down into the slot under
// "It's very calm here", like a start page, and the button groups on either
// side slide in next to the search field. It all slides back as soon as there
// are results to show. Only transforms change, so the animation stays smooth
// and the page layout itself never moves.
const narrowView = matchMedia("(max-width: 720px)");

function placeToolbar() {
  const bar = $(".toolbar");
  const [left, search, right] = bar.children;
  const slot = listEl.querySelector(".calm-bar-slot");
  document.body.classList.toggle("bar-centered", !!slot);
  if (slot) slot.style.height = `${bar.offsetHeight}px`;
  const y = slot ? Math.round(slot.getBoundingClientRect().top - bar.offsetTop) : 0;
  bar.style.transform = y ? `translateY(${y}px)` : "";
  let dl = 0, dr = 0;
  if (slot && !narrowView.matches) {
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    dl = search.offsetLeft - gap - (left.offsetLeft + left.offsetWidth);
    dr = search.offsetLeft + search.offsetWidth + gap - right.offsetLeft;
  }
  left.style.transform = dl ? `translateX(${Math.round(dl)}px)` : "";
  right.style.transform = dr ? `translateX(${Math.round(dr)}px)` : "";
}

// While the window is being resized, follow it directly instead of animating.
let resizeTimer;
window.addEventListener("resize", () => {
  document.body.classList.add("resizing");
  placeToolbar();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => document.body.classList.remove("resizing"), 150);
});

// "See History · Learn More · Shortcuts", shown when no other tabs are open.
const calmLinks = () => `
  <div class="calm-text-links">
    <button type="button" class="text-link" data-see-history title="Open your browsing history (⌥H)">See History</button>
    <span aria-hidden="true">·</span>
    <button type="button" class="text-link" data-start-tour title="Take the Tabie tour">Learn More</button>
    <span aria-hidden="true">·</span>
    <button type="button" class="text-link" data-show-starred title="Open your shortcuts">Shortcuts</button>
  </div>`;

// Outlined Tabie mark, for the calm empty screen and the end-of-tabs badge.
function calmMark(cls) {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
    <rect x="1" y="1" width="62" height="62" rx="15" class="calm-tile"/>
    <rect x="15" y="15" width="15" height="15" rx="2.5"/>
    <rect x="34" y="15" width="15" height="15" rx="2.5"/>
    <rect x="15" y="34" width="15" height="15" rx="2.5"/>
    <rect x="34" y="34" width="15" height="15" rx="2.5"/>
  </svg>`;
}

// ---------- in-place DOM updates ----------
// render() runs several times when a tab closes (instantly, after the browser
// confirms, and on every tab/preview event). Replacing innerHTML each time
// recreated every preview <img>, which blanked and redecoded: a visible
// flicker. Instead, patch the existing nodes and only touch what changed.

const nodeKey = (n) => n.nodeType === 1
  ? n.dataset.tab ?? n.dataset.shortcut ?? n.dataset.closed ?? n.dataset.historyUrl ?? n.dataset.dl ?? null
  : null;

function patchHtml(parent, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  patchChildren(parent, tpl.content);
}

function patchChildren(from, to) {
  const keyed = new Map();
  for (const c of from.childNodes) {
    const k = nodeKey(c);
    if (k != null) keyed.set(k, c);
  }
  let cur = from.firstChild;
  for (const next of [...to.childNodes]) {
    const k = nodeKey(next);
    let match = k != null ? keyed.get(k) : null;
    if (match) keyed.delete(k);
    else if (cur && nodeKey(cur) == null && k == null && cur.nodeName === next.nodeName) match = cur;
    if (!match) {
      from.insertBefore(next, cur);
      continue;
    }
    if (match !== cur) from.insertBefore(match, cur);
    else cur = cur.nextSibling;
    patchNode(match, next);
  }
  while (cur) {
    const after = cur.nextSibling;
    cur.remove();
    cur = after;
  }
}

function patchNode(from, to) {
  if (from.isEqualNode(to)) return;
  if (from.nodeType !== 1) {
    from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of to.attributes) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  if (from.type === "checkbox") from.checked = to.hasAttribute("checked");
  patchChildren(from, to);
}

function render() {
  state.items = [];
  const terms = queryTerms();
  const searching = terms.length > 0;

  $("#starred-count").textContent = state.starred.size;

  const open = [];
  for (const tab of state.tabs) {
    const m = match(tab.title, tab.url, terms);
    if (m) open.push({ tab, score: m.score, terms: m.terms });
  }
  sortTabs(open, searching);

  const html = [];
  // List mode: one column header at the top, like Finder's list view.
  if (state.layout === "list" && open.length) html.push(listHeader());
  for (const section of openSections(open)) {
    html.push(sectionTitle(section));
    html.push(tabList(section.items));
  }
  // Shortcuts that aren't open show up in search results too.
  const shortcuts = searching ? closedShortcuts(terms) : [];
  if (shortcuts.length) {
    html.push(sectionTitle({ label: "Shortcuts", n: shortcuts.length }));
    html.push(shortcutList(shortcuts));
  }

  // While searching, recently closed tabs are searched too and listed below.
  const closed = searching ? closedMatches(terms) : [];
  if (closed.length) {
    html.push(sectionTitle({ label: "Recently Closed", n: closed.length }));
    html.push(`<div class="rows">${closed.map(closedRow).join("")}</div>`);
  }

  // Pages from your browser history (not already open or a shortcut).
  const history = searching ? historyMatches(terms) : [];
  if (history.length) {
    html.push(sectionTitle({ label: "History", n: history.length }));
    html.push(`<div class="rows">${history.map(historyResultRow).join("")}</div>`);
  }

  // Files you downloaded in this browser are searched too.
  const downloads = searching ? downloadMatches(terms).slice(0, 8) : [];
  if (downloads.length) {
    html.push(sectionTitle({ label: "Downloads", n: downloads.length }));
    html.push(`<div class="rows">${downloads.map(downloadResultRow).join("")}</div>`);
  }

  // Big, faint Tabie watermark at the very end of your open tabs.
  if (!searching && open.length) {
    html.push(`
      <div class="watermark" aria-hidden="true">
        ${calmMark("watermark-logo")}
        <span class="watermark-name">Tabie</span>
        <span class="watermark-sub">Used by 100+ devs</span>
      </div>`);
  }

  const q = escapeHtml(state.query.trim());
  const nothingMatches = searching && !open.length && !shortcuts.length && !closed.length && !history.length && !downloads.length;
  if (nothingMatches) {
    // Nothing in your tabs: the suggestion list under the search bar takes over,
    // like a browser address bar. The page itself just stays quiet.
    html.push(`
      <div class="calm calm-search">
        <p class="calm-title">No tabs match “${q}”</p>
        <p class="calm-sub">Press <kbd>↩</kbd> to ${engine().verb ? "ask" : "search"} ${engine().name}, or pick a suggestion above.</p>
        ${state.tabs.length ? "" : calmLinks()}
      </div>`);
  } else if (searching) {
    // Always offer the web as the last result, like Spotlight.
    const idx = state.items.push({ kind: "search" }) - 1;
    html.push(`
      <div class="rows web-row-wrap">
        <div class="row web-row" data-idx="${idx}" data-search>
          <span class="lead"><span class="fav web-fav">${ICON.search}</span></span>
          <span class="c-name"><span class="title">${engine().verb ? `${engineVerb()} “${q}”` : `Search ${engine().name} for “${q}”`}</span></span>
          <span class="c-site">${engine().site}</span>
          <span class="c-time">New tab</span>
        </div>
      </div>`);
  } else if (!open.length && !shortcuts.length) {
    // Calm, greyed-out empty state with the Tabie mark, centred in the window.
    html.push(`
      <div class="calm">
        ${calmMark("calm-logo")}
        <p class="calm-title">It’s very calm here</p>
        <p class="calm-sub">No other tabs are open.</p>
        <div class="calm-bar-slot"></div>
        ${calmLinks()}
      </div>`);
  }
  // No other tabs at all: the toolbar search grows a little and takes centre stage.
  document.body.classList.toggle("no-tabs", !state.tabs.length);
  state.nothingMatches = nothingMatches;
  showSuggestions(nothingMatches);
  listEl.classList.toggle("list-mode", state.layout === "list");
  patchHtml(listEl, html.join(""));
  placeToolbar();
  clampCursor();
  paintCursor();
  updateSelectionBar();
  renderHistory(terms);
  renderDownloads();
  renderStars();
}

// ---------- recently closed ----------

function closedMatches(terms) {
  return state.closed
    .map((c) => ({ c, m: match(c.title, `${c.url || ""} ${c.sub || ""}`, terms) }))
    .filter((x) => x.m)
    .map((x) => ({ ...x.c, terms: x.m.terms }));
}

// A search result row for a closed tab or window; Enter or click reopens it.
function closedRow(c) {
  const idx = state.items.push({ kind: "closed", id: c.sid }) - 1;
  return `
    <div class="row closed" data-idx="${idx}" data-closed="${escapeHtml(c.sid)}" title="Reopen ${escapeHtml(c.url || "")}">
      <span class="lead">${favicon(c.url, c.favIconUrl, c.title)}</span>
      <span class="c-name"><span class="title">${highlight(c.title, c.terms)}</span></span>
      <span class="c-site">${escapeHtml(c.kind === "window" ? "Window" : hostOf(c.url))}</span>
      <span class="c-time">Closed ${timeAgo(c.when)}</span>
      <span class="c-status"></span>
      <span class="row-actions"><button title="Reopen">${ICON.restore}</button></span>
    </div>`;
}

function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function renderHistory(terms = queryTerms()) {
  if (!state.historyOpen) return;
  document.querySelectorAll("[data-history-tab]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.historyTab === state.historyTab)));
  if (state.historyTab === "history") return renderBrowserHistory(terms);

  const items = closedMatches(terms);

  const el = $("#history-list");
  if (!items.length) {
    el.innerHTML = `<div class="empty">${terms.length ? "No closed tabs match." : "Tabs you close show up here."}</div>`;
    return;
  }
  const html = [];
  let lastDay = "";
  for (const c of items) {
    const day = dayLabel(c.when);
    if (day !== lastDay) {
      html.push(`<div class="day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    const time = new Date(c.when).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    html.push(`
      <div class="side-row" data-closed="${escapeHtml(c.sid)}" title="Reopen ${escapeHtml(c.url || c.title)}">
        ${favicon(c.url, c.favIconUrl, c.title)}
        <span class="title">${highlight(c.title, c.terms)}</span>
        <span class="sub">${escapeHtml(time)}</span>
        <span class="restore">${ICON.restore}</span>
      </div>`);
  }
  el.innerHTML = html.join("");
}

// ---------- browser history (history API) ----------

const HISTORY_DAYS = 90;
const openUrls = () => new Set(state.tabs.map((t) => normalizeUrl(t.url)));

async function searchHistory(text, maxResults) {
  if (!api.history?.search) return [];
  try {
    const items = await api.history.search({ text, startTime: Date.now() - HISTORY_DAYS * 864e5, maxResults });
    return items.filter((h) => h.url && !isSelf(h.url));
  } catch {
    return [];
  }
}

async function loadBrowserHistory() {
  state.historyItems = await searchHistory("", 300);
}

function renderBrowserHistory(terms) {
  const el = $("#history-list");
  if (!api.history) {
    el.innerHTML = '<div class="empty">History isn\'t available in this browser.</div>';
    return;
  }
  const items = state.historyItems
    .map((h) => ({ h, m: match(h.title || h.url, h.url, terms) }))
    .filter((x) => x.m);
  if (!items.length) {
    el.innerHTML = `<div class="empty">${terms.length ? "Nothing in your history matches." : "Pages you visit show up here."}</div>`;
    return;
  }
  const html = [];
  let lastDay = "";
  for (const { h, m } of items) {
    const day = dayLabel(h.lastVisitTime);
    if (day !== lastDay) {
      html.push(`<div class="day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    const title = h.title || hostOf(h.url);
    const time = new Date(h.lastVisitTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    html.push(`
      <div class="side-row history-row" data-history-url="${escapeHtml(h.url)}" title="${escapeHtml(h.url)}">
        ${favicon(h.url, shortcutIcon(h.url), title)}
        <span class="title">${highlight(title, m.terms)}</span>
        <span class="sub">${escapeHtml(time)}</span>
        <button class="history-remove" data-forget-url title="Remove from history" aria-label="Remove from history">${ICON.close}</button>
      </div>`);
  }
  el.innerHTML = html.join("");
}

// Open a page from history: switch to it if it's already open in a tab.
async function openUrl(url) {
  const tab = state.tabs.find((t) => normalizeUrl(t.url) === normalizeUrl(url));
  if (tab) return switchTo(tab.id);
  await api.tabs.create({ url });
}

async function forgetUrl(url) {
  try {
    await api.history.deleteUrl({ url });
  } catch {
    return toast("Couldn't remove that page");
  }
  state.historyItems = state.historyItems.filter((h) => h.url !== url);
  state.historyResults.items = state.historyResults.items.filter((h) => h.url !== url);
  renderHistory();
  render();
}

// Search results: history is fetched as you type (debounced), then rendered.
let historySearchTimer;
function scheduleHistorySearch() {
  clearTimeout(historySearchTimer);
  const q = state.query.trim();
  if (!q) {
    state.historyResults = { q: "", items: [] };
    return;
  }
  historySearchTimer = setTimeout(async () => {
    const items = await searchHistory(q, 40);
    if (state.query.trim() !== q) return;
    state.historyResults = { q, items };
    render();
  }, 120);
}

function historyMatches(terms) {
  const q = state.query.trim();
  if (state.historyResults.q !== q) return [];
  const skip = openUrls();
  for (const key of state.starred.keys()) skip.add(key);
  const seen = new Set();
  return state.historyResults.items
    .filter((h) => {
      const key = normalizeUrl(h.url);
      if (skip.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((h) => ({ ...h, terms: match(h.title || h.url, h.url, terms)?.terms ?? terms }))
    .slice(0, 6);
}

function historyResultRow(h) {
  const idx = state.items.push({ kind: "history", id: h.url }) - 1;
  const title = h.title || hostOf(h.url);
  return `
    <div class="row history-result" data-idx="${idx}" data-history-url="${escapeHtml(h.url)}" title="${escapeHtml(h.url)}">
      <span class="lead">${favicon(h.url, shortcutIcon(h.url), title)}</span>
      <span class="c-name"><span class="title">${highlight(title, h.terms)}</span></span>
      <span class="c-site">${highlight(hostOf(h.url), h.terms)}</span>
      <span class="c-time">Visited ${timeAgo(h.lastVisitTime)}</span>
      <span class="c-status"><span class="tag">${h.visitCount > 1 ? `${h.visitCount} visits` : ""}</span></span>
      <span class="row-actions"><button data-forget-url title="Remove from history">${ICON.close}</button></span>
    </div>`;
}

const anySheetOpen = () => state.historyOpen || state.downloadsOpen || state.starsOpen;

// Open one sheet and close the others; the backdrop shows while any is open.
function closeOtherSheets(except) {
  if (except !== "history" && state.historyOpen) setHistory(false);
  if (except !== "downloads" && state.downloadsOpen) setDownloads(false);
  if (except !== "stars" && state.starsOpen) setStars(false);
}

function setHistory(open) {
  if (open) closeOtherSheets("history");
  state.historyOpen = open;
  const sheet = $("#history");
  sheet.classList.toggle("open", open);
  sheet.toggleAttribute("inert", !open);
  sheet.setAttribute("aria-hidden", String(!open));
  $("#sheet-backdrop").classList.toggle("open", anySheetOpen());
  $("#toggle-history").setAttribute("aria-pressed", String(open));
  if (open && state.historyTab === "history") loadBrowserHistory().then(() => renderHistory());
  else renderHistory();
}

function setShortcuts(open) {
  $("#shortcuts").hidden = !open;
  if (!open) queryEl.focus();
}

// ---------- downloads ----------
// Uses the browser's downloads API: only files downloaded in this browser that
// are still in its download history.

const dlIcons = new Map(); // download id -> file icon data URL
let dlPoll;

async function loadDownloads() {
  if (!api.downloads?.search) return;
  try {
    const items = await api.downloads.search({ orderBy: ["-startTime"], limit: 200 });
    state.downloads = items.filter((d) => d.filename || d.url);
  } catch {
    state.downloads = [];
  }
  const active = state.downloads.filter((d) => d.state === "in_progress").length;
  const badge = $("#downloads-active");
  badge.hidden = !active;
  badge.textContent = active;
  // Chrome doesn't report byte progress as events, so poll while something downloads.
  if (active && !dlPoll) {
    dlPoll = setInterval(async () => {
      await loadDownloads();
      if (state.downloadsOpen) renderDownloads();
    }, 1000);
  } else if (!active && dlPoll) {
    clearInterval(dlPoll);
    dlPoll = null;
  }
}

function fileName(d) {
  const path = d.filename || "";
  const base = path.split(/[\\/]/).pop();
  if (base) return base;
  try {
    return decodeURIComponent(new URL(d.finalUrl || d.url).pathname.split("/").pop()) || hostOf(d.url);
  } catch {
    return d.url;
  }
}

function formatBytes(n) {
  if (!(n >= 0)) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const dlTime = (d) => Date.parse(d.endTime || d.startTime) || 0;
const dlSite = (d) => hostOf(d.referrer || d.finalUrl || d.url);

function dlStatus(d) {
  if (d.state === "in_progress") {
    if (d.paused) return "Paused";
    const total = d.totalBytes > 0 ? ` of ${formatBytes(d.totalBytes)}` : "";
    return `${formatBytes(d.bytesReceived)}${total}`;
  }
  if (d.state === "interrupted") return d.error === "USER_CANCELED" ? "Cancelled" : "Failed";
  if (d.exists === false) return "Deleted";
  return formatBytes(d.fileSize > 0 ? d.fileSize : d.totalBytes);
}

function downloadMatches(terms) {
  return state.downloads
    .map((d) => ({ d, m: match(fileName(d), `${d.finalUrl || d.url} ${d.referrer || ""}`, terms) }))
    .filter((x) => x.m)
    .map((x) => ({ ...x.d, terms: x.m.terms }));
}

// File icon from the operating system, fetched once per download.
function fileIcon(d, size = 16) {
  const cached = dlIcons.get(d.id);
  if (!cached && d.state === "complete" && d.exists !== false && api.downloads.getFileIcon) {
    dlIcons.set(d.id, ""); // in flight
    api.downloads.getFileIcon(d.id, { size: 32 }).then((url) => {
      if (!url) return;
      dlIcons.set(d.id, url);
      document.querySelectorAll(`[data-dl-icon="${d.id}"]`).forEach((el) => {
        el.innerHTML = `<img src="${url}" alt="">`;
      });
    }).catch(() => {});
  }
  return `<span class="dl-icon" style="--s:${size}px" data-dl-icon="${d.id}">${cached ? `<img src="${cached}" alt="">` : ICON.file}</span>`;
}

function dlButtons(d) {
  const b = (action, icon, label) => `<button data-dl-action="${action}" title="${label}" aria-label="${label}">${icon}</button>`;
  if (d.state === "in_progress") {
    return (d.paused ? b("resume", ICON.play, "Resume") : b("pause", ICON.pause, "Pause")) + b("cancel", ICON.close, "Cancel");
  }
  const parts = [];
  if (d.state === "complete" && d.exists !== false) parts.push(b("show", ICON.folder, "Show in folder"));
  else parts.push(b("retry", ICON.retry, "Download again"));
  parts.push(b("erase", ICON.close, "Remove from list"));
  return parts.join("");
}

// A row in the search results, in the same columns as tabs.
function downloadResultRow(d) {
  const idx = state.items.push({ kind: "download", id: d.id }) - 1;
  return `
    <div class="row dl-result${d.exists === false ? " gone" : ""}" data-idx="${idx}" data-dl="${d.id}" title="${escapeHtml(d.filename || d.url)}">
      <span class="lead">${fileIcon(d)}</span>
      <span class="c-name"><span class="title">${highlight(fileName(d), d.terms)}</span></span>
      <span class="c-site">${escapeHtml(dlSite(d))}</span>
      <span class="c-time">${timeAgo(dlTime(d))}</span>
      <span class="c-status"><span class="tag">${escapeHtml(dlStatus(d))}</span></span>
      <span class="row-actions">${dlButtons(d)}</span>
    </div>`;
}

function renderDownloads() {
  if (!state.downloadsOpen) return;
  const el = $("#downloads-list");
  if (!api.downloads) {
    el.innerHTML = '<div class="empty">Downloads aren\'t available in this browser.</div>';
    return;
  }
  const items = queryTerms().length ? downloadMatches(queryTerms()) : state.downloads;
  if (!items.length) {
    el.innerHTML = `<div class="empty">${queryTerms().length ? "No downloads match." : "Files you download show up here."}</div>`;
    return;
  }
  const html = [];
  let lastDay = "";
  for (const d of items.slice(0, 100)) {
    const day = dayLabel(dlTime(d) || Date.now());
    if (day !== lastDay) {
      html.push(`<div class="day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    const pct = d.totalBytes > 0 ? Math.round((d.bytesReceived / d.totalBytes) * 100) : 0;
    const progress = d.state === "in_progress"
      ? `<div class="dl-progress${d.paused ? " paused" : ""}"><span style="width:${pct}%"></span></div>` : "";
    const openable = d.state === "complete" && d.exists !== false;
    html.push(`
      <div class="dl-row${openable ? " openable" : ""}${d.exists === false || d.state === "interrupted" ? " gone" : ""}" data-dl="${d.id}" title="${openable ? "Open" : ""} ${escapeHtml(d.filename || d.url)}">
        ${fileIcon(d, 28)}
        <div class="dl-main">
          <div class="dl-name">${highlight(fileName(d), d.terms || [])}</div>
          ${progress}
          <div class="dl-sub">${escapeHtml(dlStatus(d))} · ${escapeHtml(dlSite(d))}</div>
        </div>
        <div class="dl-actions">${dlButtons(d)}</div>
      </div>`);
  }
  el.innerHTML = html.join("");
}

async function downloadAction(id, action) {
  const d = state.downloads.find((x) => x.id === id);
  if (!d) return;
  try {
    if (action === "open") {
      if (d.state === "complete" && d.exists !== false) await api.downloads.open(id);
      else if (d.state !== "in_progress") toast("That file is no longer on your computer");
    } else if (action === "show") await api.downloads.show(id);
    else if (action === "pause") await api.downloads.pause(id);
    else if (action === "resume") await api.downloads.resume(id);
    else if (action === "cancel") await api.downloads.cancel(id);
    else if (action === "erase") await api.downloads.erase({ id });
    else if (action === "retry") await api.downloads.download({ url: d.finalUrl || d.url });
  } catch {
    toast("Couldn't do that with this download");
  }
  await loadDownloads();
  renderDownloads();
  render();
}

function setDownloads(open) {
  if (open) closeOtherSheets("downloads");
  state.downloadsOpen = open;
  const sheet = $("#downloads");
  sheet.classList.toggle("open", open);
  sheet.toggleAttribute("inert", !open);
  sheet.setAttribute("aria-hidden", String(!open));
  $("#sheet-backdrop").classList.toggle("open", anySheetOpen());
  $("#toggle-downloads").setAttribute("aria-pressed", String(open));
  if (open) loadDownloads().then(renderDownloads);
}

// ---------- shortcuts sheet ----------
// A simple list of every shortcut (bookmarks in the Tabie folder): open ones
// first, then the rest. Click to switch to it or open it again.

function setStars(open) {
  if (open) closeOtherSheets("stars");
  state.starsOpen = open;
  const sheet = $("#stars");
  sheet.classList.toggle("open", open);
  sheet.toggleAttribute("inert", !open);
  sheet.setAttribute("aria-hidden", String(!open));
  $("#sheet-backdrop").classList.toggle("open", anySheetOpen());
  $("#starred").setAttribute("aria-pressed", String(open));
  renderStars();
}

function renderStars() {
  if (!state.starsOpen) return;
  const el = $("#stars-list");
  const terms = queryTerms();
  const openKeys = new Set(state.tabs.map((t) => normalizeUrl(t.url)));
  const items = [...state.starred.entries()]
    .map(([key, b]) => ({ ...b, key, isOpen: openKeys.has(key), m: match(b.title || b.url, b.url, terms) }))
    .filter((b) => b.m)
    .sort((a, b) => b.isOpen - a.isOpen || (a.title || a.url).localeCompare(b.title || b.url));
  if (!items.length) {
    el.innerHTML = `<div class="empty">${terms.length ? "No shortcuts match." : "No Shortcuts yet.<br>Star a tab from its card, or press ⌥S."}</div>`;
    return;
  }
  const html = [];
  let section = null;
  for (const b of items) {
    const label = b.isOpen ? "Open" : "Not open";
    if (label !== section) {
      html.push(`<div class="day">${label}</div>`);
      section = label;
    }
    const title = b.title || hostOf(b.url);
    html.push(`
      <div class="side-row star-row" data-shortcut="${escapeHtml(b.key)}" title="${b.isOpen ? "Switch to" : "Open"} ${escapeHtml(b.url)}">
        ${favicon(b.url, shortcutIcon(b.url), title)}
        <span class="title">${highlight(title, b.m.terms)}</span>
        <span class="sub">${escapeHtml(hostOf(b.url))}</span>
        <button class="star-remove" data-action="unstar" title="Remove shortcut" aria-label="Remove shortcut">${ICON.star}</button>
      </div>`);
  }
  el.innerHTML = html.join("");
}

// ---------- confirmation dialog ----------
// Footer actions explain what they'll do (and why it helps) before running.

let confirmResolve = null;

function confirmAction({ icon, title, body }) {
  $("#confirm-icon").innerHTML = icon;
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm").hidden = false;
  $("#confirm-ok").focus();
  return new Promise((resolve) => (confirmResolve = resolve));
}

function closeConfirm(ok) {
  if (!confirmResolve) return;
  $("#confirm").hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  queryEl.focus();
  resolve(ok);
}

function openSections(open) {
  if (!open.length) return [];
  if (state.group === "site") {
    const groups = new Map();
    for (const m of open) {
      const h = hostOf(m.tab.url);
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push(m);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([host, items]) => ({
        label: host,
        n: items.length,
        items,
        actions: [["window-site", "Open in new window", host], ["close-site", "Close all tabs from this site", host]],
      }));
  }
  return [{ label: "Open tabs", n: open.length, items: open }];
}

// Group actions are small grey icons right next to the group name.
const SECTION_ICONS = {
  "window-site": ICON.newWindow,
  "close-site": ICON.trash,
};

function sectionTitle({ label, n, actions = [], focusWindow }) {
  const btns = actions
    .map(([action, text, arg]) =>
      `<button class="sec-icon" data-section-action="${action}" data-arg="${escapeHtml(arg)}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">${SECTION_ICONS[action] || ""}</button>`)
    .join("");
  const attrs = focusWindow ? ` class="section-title clickable" data-focus-window="${focusWindow}" title="Go to this window"` : ' class="section-title"';
  return `<div${attrs}><span>${escapeHtml(label)}</span><span class="n">${n ?? ""}</span>${btns ? `<span class="sec-actions">${btns}</span>` : ""}</div>`;
}

function tabList(items) {
  if (state.layout === "list") return `<div class="rows">${items.map(tabRow).join("")}</div>`;
  return `<div class="grid">${items.map(tabCard).join("")}</div>`;
}

function preview(url, favIconUrl, title) {
  const img = state.thumbs[thumbKey(url)]?.img;
  if (img) return `<img class="shot" src="${img}" alt="">`;
  return `<div class="placeholder" style="--tint:${colorFor(hostOf(url))}">
      <span class="tile">${favicon(url, favIconUrl, title)}</span>
      <span class="label">${escapeHtml(title || hostOf(url))}</span>
    </div>`;
}

function tabBadges(tab) {
  const b = [];
  if (tab.id === state.currentTabId) b.push(`<span class="pill accent">${state.selfTabId ? "Last used" : "Current"}</span>`);
  if (tab.pinned) b.push(`<span class="pill" title="Pinned">${ICON.pin}</span>`);
  if (tab.audible) b.push(`<span class="pill" title="Playing audio">${tab.mutedInfo?.muted ? ICON.muted : ICON.sound}</span>`);
  if (tab.discarded) b.push(`<span class="pill" title="Sleeping: not loaded until you open it">${ICON.moon} Sleeping</span>`);
  return b.join("");
}

function tabButtons(tab) {
  const starred = isStarred(tab.url);
  return `
    <button data-action="star" class="${starred ? "starred" : ""}" title="${starred ? "Unstar" : "Star"} (⌥S)">${ICON.star}</button>
    ${tab.audible ? `<button data-action="mute" title="${tab.mutedInfo?.muted ? "Unmute" : "Mute"}">${tab.mutedInfo?.muted ? ICON.muted : ICON.sound}</button>` : ""}
    <button data-action="pin" title="${tab.pinned ? "Unpin" : "Pin"}">${ICON.pin}</button>
    <button data-action="close" class="close" title="Close tab (⇧⌫)">${ICON.trash}</button>`;
}

// Large buttons in the middle of a card's preview, shown on hover.
function hoverButtons(tab) {
  const starred = isStarred(tab.url);
  const btn = (action, icon, label, extra = "") =>
    `<button data-action="${action}" class="hover-btn ${extra}" title="${label}" aria-label="${label}">${icon}<span>${label}</span></button>`;
  return `
    <div class="hover-actions">
      ${btn("star", ICON.star, starred ? "Unstar" : "Star", starred ? "on" : "")}
      ${btn("pin", ICON.pin, tab.pinned ? "Unpin" : "Pin", tab.pinned ? "on" : "")}
      ${tab.audible ? btn("mute", tab.mutedInfo?.muted ? ICON.muted : ICON.sound, tab.mutedInfo?.muted ? "Unmute" : "Mute") : ""}
      ${btn("close", ICON.trash, "Close", "danger")}
    </div>`;
}

function tabClasses(base, tab) {
  const c = [base];
  if (tab.discarded) c.push("discarded");
  if (state.selected.has(tab.id)) c.push("selected");
  return c.join(" ");
}

function tabCard({ tab, terms }) {
  const idx = state.items.push({ kind: "tab", id: tab.id }) - 1;
  const host = hostOf(tab.url);
  const starredMark = isStarred(tab.url) ? `<span class="card-star" title="Starred">${ICON.star}</span>` : "";
  return `
    <div class="${tabClasses("card", tab)}" data-idx="${idx}" data-tab="${tab.id}" title="${escapeHtml(tab.url || "")}">
      <div class="card-head">
        <span class="lead">
          ${favicon(tab.url, tab.favIconUrl, tab.title)}
          <input type="checkbox" class="mac-check" data-check="${tab.id}" ${state.selected.has(tab.id) ? "checked" : ""} title="Select (⇧↩)" aria-label="Select">
        </span>
        <span class="card-title">${highlight(tab.title || tab.url, terms)}</span>
        ${starredMark}
        <span class="card-host">${highlight(host, terms)}</span>
      </div>
      <div class="thumb">
        ${preview(tab.url, tab.favIconUrl, tab.title)}
        ${hoverButtons(tab)}
        <div class="badges">${tabBadges(tab)}</div>
      </div>
    </div>`;
}

function shortcutList(items) {
  if (state.layout === "list") return `<div class="rows">${items.map(shortcutRow).join("")}</div>`;
  return `<div class="grid">${items.map(shortcutCard).join("")}</div>`;
}

function shortcutCard(s) {
  const idx = state.items.push({ kind: "shortcut", id: s.key }) - 1;
  const title = s.title || hostOf(s.url);
  const icon = shortcutIcon(s.url);
  return `
    <div class="card shortcut" data-idx="${idx}" data-shortcut="${escapeHtml(s.key)}" title="Open ${escapeHtml(s.url)}">
      <div class="card-head">
        <span class="lead">${favicon(s.url, icon, title)}</span>
        <span class="card-title">${highlight(title, s.terms)}</span>
        <span class="card-star" title="Shortcut">${ICON.star}</span>
        <span class="card-host">${highlight(hostOf(s.url), s.terms)}</span>
      </div>
      <div class="thumb">
        ${preview(s.url, icon, title)}
        <div class="hover-actions">
          <button data-action="open-shortcut" class="hover-btn" title="Open" aria-label="Open">${ICON.newWindow}<span>Open</span></button>
          <button data-action="unstar" class="hover-btn on" title="Remove shortcut" aria-label="Remove shortcut">${ICON.star}<span>Unstar</span></button>
        </div>
        <div class="badges"><span class="pill">Not open</span></div>
      </div>
    </div>`;
}

function shortcutRow(s) {
  const idx = state.items.push({ kind: "shortcut", id: s.key }) - 1;
  const title = s.title || hostOf(s.url);
  return `
    <div class="row shortcut" data-idx="${idx}" data-shortcut="${escapeHtml(s.key)}" title="Open ${escapeHtml(s.url)}">
      <span class="lead">${favicon(s.url, shortcutIcon(s.url), title)}</span>
      <span class="c-name"><span class="title">${highlight(title, s.terms)}</span></span>
      <span class="c-site">${highlight(hostOf(s.url), s.terms)}</span>
      <span class="c-time">Not open</span>
      <span class="c-status"><span class="tag star" title="Shortcut">${ICON.star}</span></span>
      <span class="row-actions"><button data-action="unstar" title="Remove shortcut">${ICON.star}</button></span>
    </div>`;
}

function listHeader() {
  const col = (label, sort, cls) => {
    const active = sort && state.sort === sort ? " active" : "";
    return sort
      ? `<button class="th ${cls}${active}" data-sort-col="${sort}" title="Sort by ${label}">${label}</button>`
      : `<span class="th ${cls}">${label}</span>`;
  };
  return `
    <div class="thead">
      <span></span>
      ${col("Name", "az", "c-name")}
      ${col("Site", "", "c-site")}
      ${col("Last Opened", "recent", "c-time")}
      ${col("Status", "", "c-status")}
      <span></span>
    </div>`;
}

function tabRow({ tab, terms }) {
  const idx = state.items.push({ kind: "tab", id: tab.id }) - 1;
  const tags = [];
  if (tab.id === state.currentTabId) tags.push(`<span class="tag accent">${state.selfTabId ? "Last used" : "Current"}</span>`);
  if (isStarred(tab.url)) tags.push(`<span class="tag star" title="Starred">${ICON.star}</span>`);
  if (tab.pinned) tags.push(`<span class="tag" title="Pinned">${ICON.pin}</span>`);
  if (tab.audible) tags.push(`<span class="tag" title="${tab.mutedInfo?.muted ? "Muted" : "Playing"}">${tab.mutedInfo?.muted ? ICON.muted : ICON.sound}</span>`);
  if (tab.discarded) tags.push(`<span class="tag" title="Sleeping">${ICON.moon}</span>`);
  return `
    <div class="${tabClasses("row", tab)}" data-idx="${idx}" data-tab="${tab.id}" title="${escapeHtml(tab.url || "")}">
      <span class="lead">
        ${favicon(tab.url, tab.favIconUrl, tab.title)}
        <input type="checkbox" class="mac-check" data-check="${tab.id}" ${state.selected.has(tab.id) ? "checked" : ""} title="Select (⇧↩)" aria-label="Select">
      </span>
      <span class="c-name"><span class="title">${highlight(tab.title || tab.url, terms)}</span></span>
      <span class="c-site">${highlight(hostOf(tab.url), terms)}</span>
      <span class="c-time">${tab.lastAccessed ? timeAgo(tab.lastAccessed) : "—"}</span>
      <span class="c-status">${tags.join("")}</span>
      <span class="row-actions">${tabButtons(tab)}</span>
    </div>`;
}

function clampCursor() {
  state.cursor = Math.max(0, Math.min(state.cursor, state.items.length - 1));
}

function paintCursor() {
  listEl.querySelectorAll(".cursor").forEach((el) => el.classList.remove("cursor"));
  const el = listEl.querySelector(`[data-idx="${state.cursor}"]`);
  if (el) {
    el.classList.add("cursor");
    el.scrollIntoView({ block: "nearest" });
  }
}

function updateSelectionBar() {
  const n = state.selected.size;
  // Slides up from the bottom when the first tab is selected.
  const bar = $("#selection-bar");
  bar.classList.toggle("show", n > 0);
  bar.toggleAttribute("inert", n === 0);
  bar.setAttribute("aria-hidden", String(n === 0));
  // Keep the last count while the bar slides away.
  if (n) $("#selection-count").textContent = `${plural(n, "tab")} selected`;
  document.body.classList.toggle("selecting", n > 0);
}

function syncControls() {
  $("#sort").value = state.sort;
  document.querySelectorAll("[data-layout]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.layout === state.layout)));
  $("#group").value = state.group;
  syncDropdowns();
  $("#starred").setAttribute("aria-pressed", String(state.starsOpen));
}

function savePrefs() {
  const { sort, group, layout, theme, engine: searchEngine } = state;
  api.storage.local.set({ [PREFS_KEY]: { sort, group, layout, theme, engine: searchEngine } });
}

function setPref(key, value) {
  state[key] = value;
  state.cursor = 0;
  syncControls();
  savePrefs();
  render();
}

const isGrid = () => state.layout === "cards";

// In the card grid, Up/Down jump to the card visually above/below.
function moveVertical(dir) {
  const cur = listEl.querySelector(`[data-idx="${state.cursor}"]`);
  if (!cur) return;
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best = null;
  let bestRow = Infinity;
  let bestDx = Infinity;
  for (const el of listEl.querySelectorAll("[data-idx]")) {
    const er = el.getBoundingClientRect();
    const rowDist = dir > 0 ? er.top - r.bottom : r.top - er.bottom;
    if (rowDist < -1) continue;
    const dx = Math.abs(er.left + er.width / 2 - cx);
    if (rowDist < bestRow - 1 || (Math.abs(rowDist - bestRow) <= 1 && dx < bestDx)) {
      best = el;
      bestRow = rowDist;
      bestDx = dx;
    }
  }
  if (best) state.cursor = Number(best.dataset.idx);
  paintCursor();
}

function moveBy(d) {
  state.cursor = Math.max(0, Math.min(state.cursor + d, state.items.length - 1));
  paintCursor();
}

// ---------- actions ----------

async function refresh() {
  await loadTabs();
  render();
}

async function switchTo(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(tab.windowId, { focused: true });
}

async function reopen(sessionId) {
  quietUntil = performance.now() + 600;
  try {
    await api.sessions.restore(sessionId);
  } catch {
    toast("Couldn't reopen that tab");
  }
  await refresh();
}

async function closeTabs(ids) {
  if (!ids.length) return;
  quietUntil = performance.now() + 600;
  // Update the UI first so it never shows tabs that are already gone.
  const gone = new Set(ids);
  state.tabs = state.tabs.filter((t) => !gone.has(t.id));
  ids.forEach((id) => state.selected.delete(id));
  render();
  try {
    await api.tabs.remove(ids);
  } catch {
    // One of the tabs was already closed; close the rest individually.
    await Promise.allSettled(ids.map((id) => api.tabs.remove(id)));
  }
  await refresh();
}

async function toggleStar(url) {
  if (!api.bookmarks) return toast("Bookmarks aren't available in this browser");
  const key = normalizeUrl(url);
  try {
    const existing = state.starred.get(key);
    if (existing) {
      await api.bookmarks.remove(existing.id);
    } else {
      const tab = state.tabs.find((t) => normalizeUrl(t.url) === key);
      await api.bookmarks.create({ parentId: await getShortcutsFolder(), title: tab?.title || hostOf(url), url });
    }
  } catch {
    toast("Couldn't update the bookmark");
  }
  await loadStarred();
  render();
}

// Open a shortcut: switch to its tab if it's open, otherwise open it in a new tab.
async function openShortcut(key) {
  const entry = state.starred.get(key);
  if (!entry) return;
  const tab = state.tabs.find((t) => normalizeUrl(t.url) === key);
  if (tab) return switchTo(tab.id);
  await api.tabs.create({ url: entry.url });
}

function findDuplicates() {
  const seen = new Set();
  const toClose = [];
  const sorted = [...state.tabs].sort((a, b) =>
    (b.id === state.currentTabId) - (a.id === state.currentTabId) ||
    (b.pinned - a.pinned) ||
    (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  for (const tab of sorted) {
    const key = normalizeUrl(tab.url);
    if (seen.has(key)) toClose.push(tab.id);
    else seen.add(key);
  }
  return toClose;
}

// Tabs you haven't looked at for the given number of hours. Pinned, playing
// and active tabs, and the "Last used" tab, are always kept.
function oldTabs(hours) {
  const cutoff = Date.now() - hours * 3600e3;
  return state.tabs.filter((t) =>
    t.lastAccessed && t.lastAccessed < cutoff &&
    !t.active && !t.pinned && !t.audible && t.id !== state.currentTabId);
}

// Every tab except pinned ones. Tabie's own tab is never in state.tabs; in the
// side panel, the tab you're looking at is kept too.
function allCleanable() {
  return state.tabs.filter((t) => !t.pinned && (state.selfTabId || !t.active || t.windowId !== state.currentWindowId));
}

// Tabs each Super Clean option would close.
function cleanTargets(value) {
  if (value === "dupes") return findDuplicates();
  if (value === "all") return allCleanable().map((t) => t.id);
  return oldTabs(Number(value)).map((t) => t.id);
}

const AGO = { 1: "hour" };

async function superClean(value) {
  const ids = cleanTargets(value);
  const dialog = value === "dupes"
    ? {
      icon: ICON.broom,
      title: "Clean Duplicates",
      body: "Closes repeated tabs, keeping one of each, for a cleaner, lighter browser.",
      empty: "No duplicate tabs",
      done: "duplicate tab",
    }
    : value === "all"
      ? {
        icon: ICON.trash,
        title: `Clean All ${plural(ids.length, "tab")}?`,
        body: "Closes every tab except pinned ones, for a fresh start. You can reopen them from Recently Closed.",
        empty: "No tabs to clean",
        done: "tab",
      }
      : {
        icon: ICON.trash,
        title: `Clean ${plural(ids.length, "tab")}?`,
        body: `Closes tabs you haven't opened in the last ${AGO[value] ?? `${value} hours`}. Pinned and playing tabs are kept, and you can reopen any of them from Recently Closed.`,
        empty: `No tabs older than ${(AGO[value] ?? `${value} hours`).replace(/^hour$/, "1 hour")}`,
        done: "old tab",
      };
  if (!ids.length) return toast(dialog.empty);
  if (!(await confirmAction(dialog))) return;
  await closeTabs(ids);
  toast(`Cleaned ${plural(ids.length, dialog.done)}`);
}

async function sleepInactive() {
  // Only rest tabs you haven't opened in the last 30 minutes. Never rest the
  // "Last used" tab: it's the one you're most likely to go back to.
  const cutoff = Date.now() - 30 * 60e3;
  const candidates = state.tabs.filter((t) =>
    t.lastAccessed && t.lastAccessed < cutoff &&
    !t.active && !t.discarded && !t.audible && !t.pinned && t.id !== state.currentTabId);
  if (!candidates.length) return toast("Nothing to put to sleep");
  const ok = await confirmAction({
    icon: ICON.moon,
    title: "Smart Sleep",
    body: "Rests tabs you haven't used in the last 30 minutes to keep your browser fast. They wake up when you return.",
  });
  if (!ok) return;
  let n = 0;
  for (const t of candidates) {
    try {
      await api.tabs.discard(t.id);
      n++;
    } catch {
      // some tabs (e.g. internal pages) can't be discarded
    }
  }
  await refresh();
  toast(n ? `Put ${plural(n, "tab")} to sleep` : "Nothing to put to sleep");
}

async function sortBySite() {
  const ok = await confirmAction({
    icon: ICON.sort,
    title: "Magic Tabs",
    body: "Lines up your tabs by site, so you can find what you need at a glance.",
  });
  if (!ok) return;
  for (const win of state.windows) {
    const tabs = state.tabs.filter((t) => t.windowId === win.id && !t.pinned);
    const pinnedCount = state.tabs.filter((t) => t.windowId === win.id && t.pinned).length;
    const sorted = [...tabs].sort((a, b) =>
      hostOf(a.url).localeCompare(hostOf(b.url)) || (a.title || "").localeCompare(b.title || ""));
    for (let i = 0; i < sorted.length; i++) {
      await api.tabs.move(sorted[i].id, { index: pinnedCount + i }).catch(() => {});
    }
  }
  await refresh();
  toast("Sorted tabs by website");
}

async function moveToWindow(tabIds, windowId) {
  const movable = tabIds.filter((id) => !state.tabs.find((t) => t.id === id)?.pinned);
  if (movable.length) await api.tabs.move(movable, { windowId, index: -1 });
  return movable.length;
}

async function mergeWindows(onlyWindowId) {
  const ids = state.tabs
    .filter((t) => t.windowId !== state.currentWindowId && (!onlyWindowId || t.windowId === onlyWindowId))
    .map((t) => t.id);
  if (!ids.length) return toast("Only one window open");
  if (!onlyWindowId) {
    const ok = await confirmAction({
      icon: ICON.windows,
      title: "Merge Windows",
      body: "Brings tabs from your other windows into this one, so everything is in one place.",
    });
    if (!ok) return;
  }
  const n = await moveToWindow(ids, state.currentWindowId);
  await refresh();
  toast(`Moved ${plural(n, "tab")} into this window`);
}

async function moveToNewWindow(ids) {
  if (!ids.length) return;
  const [first, ...rest] = ids;
  const win = await api.windows.create({ tabId: first, focused: false });
  if (rest.length) await api.tabs.move(rest, { windowId: win.id, index: -1 });
  state.selected.clear();
  await refresh();
  toast(`Moved ${plural(ids.length, "tab")} to a new window`);
}

// ---------- tab groups ----------

let pendingGroupTabs = [];

function showGroupDialog(ids) {
  if (!ids.length) return;
  pendingGroupTabs = ids;
  $("#group-name-input").value = "";
  $("#group-color-select").value = "blue";
  $("#group-dialog").hidden = false;
  $("#group-name-input").focus();
}

function hideGroupDialog() {
  $("#group-dialog").hidden = true;
  pendingGroupTabs = [];
  queryEl.focus();
}

async function createGroup() {
  const name = $("#group-name-input").value.trim();
  const color = $("#group-color-select").value;
  const ids = pendingGroupTabs;

  if (!ids.length) {
    hideGroupDialog();
    return;
  }

  // Check if tabGroups API is available
  if (!api.tabGroups) {
    hideGroupDialog();
    toast("Tab groups aren't available in this browser");
    return;
  }

  try {
    // Group tabs together using tabs.group
    const group = await api.tabs.group({ tabIds: ids });
    if (group) {
      // Update the group with title and color
      await api.tabGroups.update(group, { title: name || "New Group", color });
      state.selected.clear();
      await refresh();
      toast(`Created group "${name || "New Group"}" with ${plural(ids.length, "tab")}`);
    }
  } catch (err) {
    console.error("Failed to create group:", err);
    toast("Couldn't create the group");
  }

  hideGroupDialog();
}

$("#group-cancel").addEventListener("click", hideGroupDialog);
$("#group-create").addEventListener("click", createGroup);
$("#group-name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    createGroup();
  } else if (e.key === "Escape") {
    hideGroupDialog();
  }
});
$("#group-dialog").addEventListener("click", (e) => {
  if (e.target === $("#group-dialog")) hideGroupDialog();
});

// ---------- export tab groups ----------

let exportGroups = [];

async function showExportDialog() {
  if (!api.tabGroups) {
    toast("Tab groups aren't available in this browser");
    return;
  }

  try {
    const groups = await api.tabGroups.query({});
    if (!groups || groups.length === 0) {
      toast("No tab groups to export");
      return;
    }

    exportGroups = groups;
    const listEl = $("#export-groups-list");
    listEl.innerHTML = groups.map(g => {
      const tabs = state.tabs.filter(t => t.groupId === g.id);
      return `
        <label class="export-group-item">
          <input type="checkbox" data-group-id="${g.id}" checked>
          <span class="export-group-color" style="background: ${g.color}"></span>
          <span class="export-group-name">${escapeHtml(g.title || "Untitled")}</span>
          <span class="export-group-count">${tabs.length} tabs</span>
        </label>
      `;
    }).join("");

    $("#export-dialog").hidden = false;
  } catch (err) {
    console.error("Failed to load tab groups:", err);
    toast("Couldn't load tab groups");
  }
}

function hideExportDialog() {
  $("#export-dialog").hidden = true;
  queryEl.focus();
}

// Color hex mapping for Chrome tab groups
const COLOR_HEX = {
  grey: "#9AA0A6",
  blue: "#8AB4F8",
  red: "#F28B82",
  yellow: "#FDD663",
  green: "#81C995",
  pink: "#FF8BCB",
  purple: "#C58AF9",
  cyan: "#78D9EC",
  orange: "#FBBC04"
};

async function exportTabGroups() {
  const includePreviews = $("#export-include-previews").checked;
  const selectedGroupIds = [...document.querySelectorAll("#export-groups-list input:checked")]
    .map(el => parseInt(el.dataset.groupId));

  if (selectedGroupIds.length === 0) {
    toast("Please select at least one group");
    return;
  }

  const selectedGroups = exportGroups.filter(g => selectedGroupIds.includes(g.id));

  // Build export data
  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    groups: []
  };

  const previewImages = [];

  for (const group of selectedGroups) {
    const tabs = state.tabs.filter(t => t.groupId === group.id);
    const groupTabs = [];

    for (const tab of tabs) {
      const tabData = {
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned,
        favIconUrl: tab.favIconUrl
      };

      // Add preview if available and requested
      if (includePreviews) {
        const previewKey = thumbKey(tab.url);
        const preview = state.thumbs[previewKey];
        if (preview && preview.img) {
          // Extract base64 data without the data URL prefix
          const base64Data = preview.img.replace(/^data:image\/jpeg;base64,/, "");
          const filename = `${group.id}_${tab.id}.jpg`;
          tabData.previewFile = filename;
          previewImages.push({
            filename,
            data: base64Data
          });
        }
      }

      groupTabs.push(tabData);
    }

    exportData.groups.push({
      id: group.id,
      title: group.title,
      color: group.color,
      colorHex: COLOR_HEX[group.color] || "#9AA0A6",
      collapsed: group.collapsed,
      tabs: groupTabs
    });
  }

  // Download JSON file
  const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const jsonUrl = URL.createObjectURL(jsonBlob);
  const timestamp = new Date().toISOString().slice(0, 10);
  await api.downloads.download({
    url: jsonUrl,
    filename: `tabie-groups-${timestamp}.json`,
    saveAs: true
  });
  URL.revokeObjectURL(jsonUrl);

  // Download ZIP with previews if requested
  if (includePreviews && previewImages.length > 0) {
    // Create a simple text file with all previews (since we can't use JSZip without external library)
    // Each preview is a base64-encoded JPEG
    const previewsData = previewImages.map(p => ({
      filename: p.filename,
      data: p.data
    }));
    const previewsBlob = new Blob([JSON.stringify(previewsData, null, 2)], { type: "application/json" });
    const previewsUrl = URL.createObjectURL(previewsBlob);
    await api.downloads.download({
      url: previewsUrl,
      filename: `tabie-previews-${timestamp}.json`,
      saveAs: true
    });
    URL.revokeObjectURL(previewsUrl);
  }

  hideExportDialog();
  toast(`Exported ${plural(selectedGroups.length, "group")} with ${includePreviews ? "previews" : "no previews"}`);
}

$("#export-cancel").addEventListener("click", hideExportDialog);
$("#export-do").addEventListener("click", exportTabGroups);
$("#export-dialog").addEventListener("click", (e) => {
  if (e.target === $("#export-dialog")) hideExportDialog();
});

function searchWeb(query) {
  const q = query.trim();
  if (!q) return;
  if (engine().ai) return askAI(AI_ASSISTANTS.find((a) => a.name === engine().ai), q);
  rememberSearch(q);
  api.tabs.create({ url: engine().search(q) });
  // Like an address bar: clear the field once the search is on its way.
  queryEl.value = "";
  state.query = "";
  render();
}

// ---------- address-bar style suggestions ----------
// Shown under the search field when nothing in your tabs matches: a Google
// search for what you typed, Google's own suggestions, and your recent searches.

const suggest = { visible: false, items: [], index: 0, google: new Map(), recent: [] };
let suggestTimer;

async function loadRecentSearches() {
  const data = await api.storage.local.get(RECENT_SEARCHES_KEY);
  suggest.recent = data[RECENT_SEARCHES_KEY] || [];
}

function rememberSearch(q) {
  suggest.recent = [q, ...suggest.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  api.storage.local.set({ [RECENT_SEARCHES_KEY]: suggest.recent });
}

function forgetSearch(q) {
  suggest.recent = suggest.recent.filter((r) => r !== q);
  api.storage.local.set({ [RECENT_SEARCHES_KEY]: suggest.recent });
  showSuggestions(true);
}

// The engine's suggestion endpoint (the one browsers use for their address
// bar). All three return [query, [suggestions…]].
async function fetchGoogleSuggestions(q) {
  if (suggest.google.has(q)) return;
  try {
    const res = await fetch((engine().suggest ?? ENGINES.google.suggest)(q));
    const data = await res.json();
    suggest.google.set(q, Array.isArray(data?.[1]) ? data[1].slice(0, 6) : []);
  } catch {
    suggest.google.set(q, []); // offline or blocked: just show the rest
  }
  if (state.query.trim() === q && suggest.visible) showSuggestions(true);
}

function showSuggestions(show) {
  const el = $("#suggest");
  const q = state.query.trim();
  if (!show || !q || document.activeElement !== queryEl) {
    suggest.visible = false;
    el.hidden = true;
    return;
  }
  const lower = q.toLowerCase();
  const seen = new Set([lower]);
  const items = [{ type: "search", text: q }];
  for (const r of suggest.recent) {
    if (items.length >= 4) break;
    if (r.toLowerCase().includes(lower) && !seen.has(r.toLowerCase())) {
      items.push({ type: "recent", text: r });
      seen.add(r.toLowerCase());
    }
  }
  for (const g of suggest.google.get(q) || []) {
    if (items.length >= 9) break;
    if (!seen.has(g.toLowerCase())) {
      items.push({ type: "google", text: g });
      seen.add(g.toLowerCase());
    }
  }
  // Always offer to ask an AI assistant, as the last rows.
  for (const ai of AI_ASSISTANTS) if (ai.name !== engine().ai) items.push({ type: "ai", text: q, ai });

  if (!suggest.google.has(q)) {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => fetchGoogleSuggestions(q), 120);
  }

  // Keep the highlighted row on the same text when the list refreshes.
  const prev = suggest.items[suggest.index]?.text;
  suggest.items = items;
  const keep = items.findIndex((i) => i.text === prev);
  suggest.index = suggest.visible && keep >= 0 ? keep : 0;
  suggest.visible = true;

  // Bold the part the user hasn't typed, like Google does.
  const rest = (text) => {
    const i = text.toLowerCase().indexOf(lower);
    if (i === -1) return `<b>${escapeHtml(text)}</b>`;
    return `<b>${escapeHtml(text.slice(0, i))}</b>${escapeHtml(text.slice(i, i + q.length))}<b>${escapeHtml(text.slice(i + q.length))}</b>`;
  };
  el.innerHTML = items.map((item, i) => `
    <div class="suggest-row${i === suggest.index ? " active" : ""}${item.type === "ai" && items[i - 1]?.type !== "ai" ? " first-ai" : ""}" role="option" aria-selected="${i === suggest.index}" data-suggest="${i}">
      <span class="suggest-icon">${item.type === "ai" ? favicon(item.ai.home, shortcutIcon(item.ai.home) || item.ai.icon, item.ai.name) : item.type === "recent" ? ICON.clock : ICON.search}</span>
      <span class="suggest-text">${
        item.type === "ai" ? `Ask ${escapeHtml(item.ai.name)} <span class="suggest-hint">— ${escapeHtml(item.text)}</span>`
        : item.type === "search" ? `${escapeHtml(item.text)} <span class="suggest-hint">— ${engineVerb()}</span>` : rest(item.text)}</span>
      ${item.type === "recent" ? `<button class="suggest-remove" data-forget="${i}" title="Remove from recent searches" aria-label="Remove">${ICON.close}</button>` : ""}
      ${i === suggest.index ? '<kbd class="suggest-enter">↩</kbd>' : ""}
    </div>`).join("");
  el.hidden = false;
}

// AI assistants that accept a prompt in the URL. Gemini doesn't, so its prompt is
// copied to the clipboard and Gemini opens ready for you to paste.
const AI_ASSISTANTS = [
  { name: "Claude", home: "https://claude.ai/", icon: "https://claude.ai/favicon.ico", url: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { name: "ChatGPT", home: "https://chatgpt.com/", icon: "https://chatgpt.com/favicon.ico", url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  { name: "Gemini", home: "https://gemini.google.com/", icon: "https://www.google.com/s2/favicons?domain=gemini.google.com&sz=32", url: () => "https://gemini.google.com/app", copy: true },
];

async function askAI(ai, q) {
  if (ai.copy) {
    try {
      await navigator.clipboard.writeText(q);
      toast(`Copied — paste it into ${ai.name} (⌘V)`);
    } catch {
      // clipboard blocked: just open the assistant
    }
  }
  rememberSearch(q);
  api.tabs.create({ url: ai.url(q) });
  queryEl.value = "";
  state.query = "";
  render();
}

function runSuggestion(item) {
  if (item?.type === "ai") return askAI(item.ai, item.text);
  searchWeb(item?.text ?? state.query);
}

function moveSuggestion(d) {
  suggest.index = (suggest.index + d + suggest.items.length) % suggest.items.length;
  showSuggestions(true);
}

$("#suggest").addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep focus in the search field
  const forget = e.target.closest("[data-forget]");
  if (forget) return forgetSearch(suggest.items[Number(forget.dataset.forget)].text);
  const row = e.target.closest("[data-suggest]");
  if (row) runSuggestion(suggest.items[Number(row.dataset.suggest)]);
});
$("#suggest").addEventListener("mousemove", (e) => {
  const row = e.target.closest("[data-suggest]");
  if (!row || Number(row.dataset.suggest) === suggest.index) return;
  suggest.index = Number(row.dataset.suggest);
  showSuggestions(true);
});
queryEl.addEventListener("blur", () => showSuggestions(false));
queryEl.addEventListener("focus", () => showSuggestions(state.nothingMatches));

function activateItem(item) {
  if (!item) return;
  if (item.kind === "search") return searchWeb(state.query);
  if (item.kind === "download") return downloadAction(item.id, "open");
  if (item.kind === "shortcut") return openShortcut(item.id);
  if (item.kind === "history") return openUrl(item.id);
  if (item.kind === "tab") return switchTo(item.id);
  if (item.kind === "closed") return reopen(item.id);
}

function toggleSelect(tabId) {
  if (state.selected.has(tabId)) state.selected.delete(tabId);
  else state.selected.add(tabId);
  const on = state.selected.has(tabId);
  listEl.querySelectorAll(`[data-tab="${tabId}"]`).forEach((el) => el.classList.toggle("selected", on));
  const cb = listEl.querySelector(`[data-check="${tabId}"]`);
  if (cb) cb.checked = on;
  updateSelectionBar();
}

// ---------- dropdown menus ----------
// Custom macOS-style menus for Sort and Group. The hidden <select> keeps the
// value and still fires "change", so the rest of the code doesn't change.

const CHECK = '<svg viewBox="0 0 16 16"><path d="M6.4 11.6 2.8 8l1.1-1.1 2.5 2.5 5.7-5.7 1.1 1.1z"/></svg>';
const CHEVRONS = '<svg viewBox="0 0 16 16"><path d="M8 2.5 11.5 6h-7zm0 11L4.5 10h7z"/></svg>';
let openDropdown = null;

function initDropdowns() {
  document.querySelectorAll(".dropdown").forEach((dd) => {
    const select = dd.querySelector("select");
    const icon = dd.querySelector(":scope > svg");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dropdown-btn";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.title = select.getAttribute("aria-label") || "";
    button.innerHTML = "iconOnly" in dd.dataset
      ? (icon ? icon.outerHTML : "")
      : `${icon ? icon.outerHTML : ""}<span class="dropdown-label"></span><span class="chevrons">${CHEVRONS}</span>`;
    // Action menus (Super Clean) run a command instead of keeping a value.
    if ("action" in dd.dataset) select.selectedIndex = -1;
    if ("iconOnly" in dd.dataset) button.classList.add("icon-only");
    icon?.remove();

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.innerHTML = `<div class="menu-title">${escapeHtml(dd.dataset.menuTitle || "")}</div>` +
      [...select.options].map((o) =>
        ("sep" in o.dataset ? '<div class="menu-sep"></div>' : "") +
        `<button type="button" role="menuitemradio" class="menu-item${"danger" in o.dataset ? " danger" : ""}" data-value="${escapeHtml(o.value)}"><span class="menu-check">${CHECK}</span>${escapeHtml(o.textContent)}<span class="menu-count"></span></button>`).join("");

    select.classList.add("native-hidden");
    select.tabIndex = -1;
    dd.append(button, menu);

    button.addEventListener("click", () => (openDropdown === dd ? closeDropdown() : openDropdownMenu(dd)));
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        openDropdownMenu(dd);
      }
    });
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".menu-item");
      if (!item) return;
      chooseDropdown(dd, item.dataset.value);
    });
    menu.addEventListener("mousemove", (e) => {
      const item = e.target.closest(".menu-item");
      if (item && document.activeElement !== item) item.focus({ preventScroll: true });
    });
    menu.addEventListener("keydown", (e) => {
      // Keep these keys away from the tab grid's shortcuts.
      e.stopPropagation();
      const items = [...menu.querySelectorAll(".menu-item")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(i + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        items[e.key === "Home" ? 0 : items.length - 1].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (items[i]) chooseDropdown(dd, items[i].dataset.value);
      } else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        closeDropdown(true);
      }
    });
  });
  syncDropdowns();
}

function syncDropdowns() {
  document.querySelectorAll(".dropdown").forEach((dd) => {
    const select = dd.querySelector("select");
    const label = dd.querySelector(".dropdown-label");
    if (label) label.textContent = dd.dataset.label ?? select.options[select.selectedIndex]?.textContent ?? "";
    dd.querySelectorAll(".menu-item").forEach((item) =>
      item.setAttribute("aria-checked", String(item.dataset.value === select.value)));
  });
}

function openDropdownMenu(dd) {
  closeDropdown();
  openDropdown = dd;
  const menu = dd.querySelector(".menu");
  if (dd.querySelector("#clean")) {
    menu.querySelectorAll(".menu-item").forEach((item) => {
      const n = cleanTargets(item.dataset.value).length;
      item.querySelector(".menu-count").textContent = n ? plural(n, "tab") : "None";
      item.classList.toggle("muted", !n);
    });
  }
  menu.hidden = false;
  dd.querySelector(".dropdown-btn").setAttribute("aria-expanded", "true");
  const current = menu.querySelector('.menu-item[aria-checked="true"]') ?? menu.querySelector(".menu-item");
  current?.focus({ preventScroll: true });
}

function closeDropdown(refocus = false) {
  if (!openDropdown) return;
  const dd = openDropdown;
  openDropdown = null;
  dd.querySelector(".menu").hidden = true;
  const button = dd.querySelector(".dropdown-btn");
  button.setAttribute("aria-expanded", "false");
  if (refocus) button.focus();
}

function chooseDropdown(dd, value) {
  const select = dd.querySelector("select");
  closeDropdown();
  queryEl.focus();
  if (select.value === value && !("action" in dd.dataset)) return;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  if ("action" in dd.dataset) select.selectedIndex = -1;
}

document.addEventListener("mousedown", (e) => {
  if (openDropdown && !openDropdown.contains(e.target)) closeDropdown();
});
window.addEventListener("blur", () => closeDropdown());

initDropdowns();

// ---------- events ----------

queryEl.addEventListener("input", () => {
  state.query = queryEl.value;
  state.cursor = 0;
  scheduleHistorySearch();
  render();
});

document.addEventListener("keydown", (e) => {
  if (confirmResolve) {
    // Only the dialog listens while it's open. Enter = OK, Esc = Cancel.
    if (e.key === "Escape") {
      e.preventDefault();
      closeConfirm(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      closeConfirm(document.activeElement !== $("#confirm-cancel"));
    } else if (e.key === "Tab") {
      e.preventDefault();
      (document.activeElement === $("#confirm-ok") ? $("#confirm-cancel") : $("#confirm-ok")).focus();
    }
    return;
  }
  if (openDropdown) return; // the open menu handles its own keys
  if (suggest.visible && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSuggestion(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSuggestion(suggest.items[suggest.index] ?? { type: "search", text: state.query });
      return;
    }
  }
  const inForm = e.target.closest?.("select");

  // ⌘K / Ctrl+K: keyboard shortcuts. ⌥H / Alt+H: recently closed.
  // e.code is used because macOS turns Option+letter into other characters.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyK") {
    e.preventDefault();
    setShortcuts($("#shortcuts").hidden);
    return;
  }
  if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyD") {
    e.preventDefault();
    setDownloads(!state.downloadsOpen);
    return;
  }
  if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyH") {
    e.preventDefault();
    setHistory(!state.historyOpen);
    return;
  }
  if (!$("#shortcuts").hidden) {
    if (e.key === "Escape") {
      e.preventDefault();
      setShortcuts(false);
    }
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    if (state.historyOpen) {
      setHistory(false);
      return;
    }
    if (state.downloadsOpen) {
      setDownloads(false);
      return;
    }
    if (state.starsOpen) {
      setStars(false);
      return;
    }
    if (state.selected.size) {
      state.selected.clear();
      render();
      return;
    }
    if (queryEl.value) {
      queryEl.value = "";
      state.query = "";
      return render();
    }
    // As a page, Esc takes you back to the tab you came from.
    if (state.selfTabId && state.currentTabId) switchTo(state.currentTabId);
    return;
  }
  if (inForm) return;

  const item = state.items[state.cursor];
  // Option/Alt+S: star. Use e.code because macOS turns Option+S into "ß".
  if (e.altKey && e.code === "KeyS") {
    e.preventDefault();
    const tab = item?.kind === "tab" && state.tabs.find((t) => t.id === item.id);
    if (tab) toggleStar(tab.url);
    else if (item?.kind === "shortcut") toggleStar(state.starred.get(item.id)?.url ?? item.id);
    return;
  }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      isGrid() ? moveVertical(1) : moveBy(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      isGrid() ? moveVertical(-1) : moveBy(-1);
      break;
    case "ArrowRight":
    case "ArrowLeft":
      // Leave the arrows to the search box while there's text in it.
      if (isGrid() && !queryEl.value) {
        e.preventDefault();
        moveBy(e.key === "ArrowRight" ? 1 : -1);
      }
      break;
    case "PageDown":
      e.preventDefault();
      moveBy(8);
      break;
    case "PageUp":
      e.preventDefault();
      moveBy(-8);
      break;
    case "Enter":
      e.preventDefault();
      if (e.shiftKey && item?.kind === "tab") toggleSelect(item.id);
      else activateItem(item);
      break;
    case "Delete":
    case "Backspace":
      if ((e.key === "Delete" || e.shiftKey) && item?.kind === "tab") {
        e.preventDefault();
        closeTabs([item.id]);
      }
      break;
    default:
      // Typing anywhere goes into the search box.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement !== queryEl) {
        queryEl.focus();
      }
  }
});

listEl.addEventListener("click", async (e) => {
  const t = e.target;

  if (t.matches("input[type=checkbox][data-check]")) {
    e.stopPropagation();
    toggleSelect(Number(t.dataset.check));
    return;
  }

  const sectionBtn = t.closest("[data-section-action]");
  if (sectionBtn) {
    const { sectionAction, arg } = sectionBtn.dataset;
    const ids = state.tabs.filter((x) => hostOf(x.url) === arg).map((x) => x.id);
    if (sectionAction === "close-site") {
      await closeTabs(ids);
      toast(`Closed ${plural(ids.length, "tab")} from ${arg}`);
    } else if (sectionAction === "window-site") {
      await moveToNewWindow(ids);
    } else if (sectionAction === "merge-window") {
      await mergeWindows(Number(arg));
    }
    return;
  }

  const focusWin = t.closest("[data-focus-window]");
  if (focusWin) {
    await api.windows.update(Number(focusWin.dataset.focusWindow), { focused: true });
    return;
  }

  if (t.closest("[data-see-history]")) return setHistory(true);
  // "Learn More" starts the tour; onboarding.js listens for it.
  if (t.closest("[data-start-tour]")) return;

  // "Shortcuts" on the empty screen opens the Shortcuts sheet.
  if (t.closest("[data-show-starred]")) return setStars(true);

  const histEl = t.closest("[data-history-url]");
  if (histEl) {
    if (t.closest("[data-forget-url]")) return forgetUrl(histEl.dataset.historyUrl);
    if (performance.now() < quietUntil) return;
    return openUrl(histEl.dataset.historyUrl);
  }

  const shortcutEl = t.closest("[data-shortcut]");
  if (shortcutEl) {
    const key = shortcutEl.dataset.shortcut;
    if (t.closest('[data-action="unstar"]')) return toggleStar(state.starred.get(key)?.url ?? key);
    if (performance.now() < quietUntil) return;
    return openShortcut(key);
  }

  const dlRow = t.closest("[data-dl]");
  if (dlRow) {
    const action = t.closest("[data-dl-action]")?.dataset.dlAction ?? "open";
    return downloadAction(Number(dlRow.dataset.dl), action);
  }

  const sortCol = t.closest("[data-sort-col]");
  if (sortCol) return setPref("sort", sortCol.dataset.sortCol);

  if (t.closest("[data-search]")) return searchWeb(state.query);

  const closedEl = t.closest("[data-closed]");
  if (closedEl) {
    if (performance.now() < quietUntil) return;
    return reopen(closedEl.dataset.closed);
  }

  const el = t.closest("[data-tab]");
  if (!el) return;
  const tabId = Number(el.dataset.tab);
  const tab = state.tabs.find((x) => x.id === tabId);
  if (!tab) return refresh(); // stale card: the tab closed in the meantime
  const action = t.closest("[data-action]")?.dataset.action;

  if (action === "close") return closeTabs([tabId]);
  if (action === "star") return toggleStar(tab.url);
  if (action === "pin") {
    await api.tabs.update(tabId, { pinned: !tab.pinned });
    return refresh();
  }
  if (action === "mute") {
    await api.tabs.update(tabId, { muted: !tab.mutedInfo?.muted });
    return refresh();
  }
  // While selecting, a click adds or removes the tab instead of opening it.
  if (e.shiftKey || e.metaKey || e.ctrlKey || state.selected.size) return toggleSelect(tabId);
  if (performance.now() < quietUntil) return;
  switchTo(tabId);
});

listEl.addEventListener("mousemove", (e) => {
  const el = e.target.closest("[data-idx]");
  if (el && Number(el.dataset.idx) !== state.cursor) {
    state.cursor = Number(el.dataset.idx);
    listEl.querySelectorAll(".cursor").forEach((x) => x.classList.remove("cursor"));
    el.classList.add("cursor");
  }
});

// Favicons that fail to load fall back to a coloured letter.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || !img.dataset.letter) return;
  brokenFavicons.add(img.getAttribute("src"));
  const span = img.parentElement;
  span.style.background = img.dataset.color;
  span.textContent = img.dataset.letter;
}, true);

$("#sort").addEventListener("change", (e) => setPref("sort", e.target.value));
document.querySelectorAll("[data-theme-choice]").forEach((b) =>
  b.addEventListener("click", () => {
    state.theme = b.dataset.themeChoice;
    applyTheme(state.theme);
    savePrefs();
  }));
document.querySelectorAll("[data-layout]").forEach((b) =>
  b.addEventListener("click", () => setPref("layout", b.dataset.layout)));
$("#group").addEventListener("change", (e) => setPref("group", e.target.value));
$("#engine").addEventListener("change", (e) => {
  suggest.google.clear(); // suggestions were for the old engine
  setPref("engine", e.target.value);
});
$("#starred").addEventListener("click", () => setStars(!state.starsOpen));
$("#close-stars").addEventListener("click", () => setStars(false));
$("#stars-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-shortcut]");
  if (!row) return;
  const key = row.dataset.shortcut;
  if (e.target.closest('[data-action="unstar"]')) return toggleStar(state.starred.get(key)?.url ?? key);
  openShortcut(key);
});

$("#new-tab").addEventListener("click", () => api.tabs.create({}));
$("#toggle-history").addEventListener("click", () => setHistory(!state.historyOpen));
$("#close-history").addEventListener("click", () => setHistory(false));
$("#sheet-backdrop").addEventListener("click", () => {
  setHistory(false);
  setDownloads(false);
  setStars(false);
});
$("#toggle-downloads").addEventListener("click", () => setDownloads(!state.downloadsOpen));
$("#close-downloads").addEventListener("click", () => setDownloads(false));
$("#open-downloads-folder").addEventListener("click", () => api.downloads?.showDefaultFolder?.());
$("#downloads-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-dl]");
  if (!row) return;
  const action = e.target.closest("[data-dl-action]")?.dataset.dlAction ?? "open";
  downloadAction(Number(row.dataset.dl), action);
});
$("#confirm-ok").addEventListener("click", () => closeConfirm(true));
$("#confirm-cancel").addEventListener("click", () => closeConfirm(false));
$("#confirm").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeConfirm(false); // click outside = Cancel
});
$("#show-shortcuts").addEventListener("click", () => setShortcuts(true));
$("#close-shortcuts").addEventListener("click", () => setShortcuts(false));
$("#shortcuts").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) setShortcuts(false); // click outside the dialog
});

// Version from the manifest, e.g. "1.6.0" -> "v1.6".
$("#version").textContent = `v${api.runtime.getManifest().version.replace(/(\.0)+$/, "")}`;

// Show ⌘ on Mac and Ctrl elsewhere.
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$("#shortcut-key").textContent = isMac ? "⌘K" : "Ctrl K";
document.querySelectorAll("kbd.mod").forEach((k) => (k.textContent = isMac ? "⌘" : "Ctrl"));
$("#history-list").addEventListener("click", (e) => {
  const page = e.target.closest("[data-history-url]");
  if (page) {
    if (e.target.closest("[data-forget-url]")) return forgetUrl(page.dataset.historyUrl);
    return openUrl(page.dataset.historyUrl);
  }
  const row = e.target.closest("[data-closed]");
  if (row) reopen(row.dataset.closed);
});
document.querySelectorAll("[data-history-tab]").forEach((b) =>
  b.addEventListener("click", async () => {
    state.historyTab = b.dataset.historyTab;
    if (state.historyTab === "history") await loadBrowserHistory();
    renderHistory();
  }));
// Keep the History sheet current as you browse or clear history.
let historyEventsTimer;
const onHistoryChanged = () => {
  clearTimeout(historyEventsTimer);
  historyEventsTimer = setTimeout(async () => {
    if (state.historyOpen && state.historyTab === "history") {
      await loadBrowserHistory();
      renderHistory();
    }
  }, 300);
};
api.history?.onVisited?.addListener(onHistoryChanged);
api.history?.onVisitRemoved?.addListener(onHistoryChanged);

$("#selection-bar").addEventListener("click", async (e) => {
  const action = e.target.closest("[data-sel]")?.dataset.sel;
  const ids = [...state.selected];
  if (action === "close") {
    await closeTabs(ids);
    toast(`Closed ${plural(ids.length, "tab")}`);
  } else if (action === "window") {
    await moveToNewWindow(ids);
  } else if (action === "group") {
    showGroupDialog(ids);
  } else if (action === "all") {
    for (const item of state.items) if (item.kind === "tab") state.selected.add(item.id);
    render();
  } else if (action === "clear") {
    state.selected.clear();
    render();
  }
});

$("#clean").addEventListener("change", (e) => superClean(e.target.value));
$("#act-sleep").addEventListener("click", sleepInactive);
$("#act-sort").addEventListener("click", sortBySite);
$("#act-merge").addEventListener("click", () => mergeWindows());
$("#act-export").addEventListener("click", showExportDialog);

// Open the side panel (Chrome/Edge) or sidebar (Firefox). Must be called
// synchronously from the click to count as a user gesture.
const panelBtn = $("#open-panel");
if (!inPanel && (api.sidePanel?.open || api.sidebarAction?.open)) {
  panelBtn.hidden = false;
  panelBtn.addEventListener("click", () => {
    const opening = api.sidePanel?.open
      ? api.sidePanel.open({ windowId: state.currentWindowId })
      : api.sidebarAction.open();
    opening.catch(() => toast("Couldn't open the side panel"));
  });
}

// Keep everything live.
let refreshTimer;
const scheduleRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
};
api.tabs.onRemoved.addListener(scheduleRefresh);
api.tabs.onCreated.addListener(scheduleRefresh);
api.tabs.onActivated.addListener(scheduleRefresh);
api.tabs.onMoved.addListener(scheduleRefresh);
api.tabs.onAttached.addListener(scheduleRefresh);
api.tabs.onUpdated.addListener((_id, info) => {
  if (info.title || info.status === "complete" || info.favIconUrl || "pinned" in info || "audible" in info || "discarded" in info) scheduleRefresh();
});
api.sessions?.onChanged?.addListener(scheduleRefresh);
// Shortcuts are bookmarks: follow edits made in the browser's bookmark manager,
// the favorites bar or another synced device.
let bookmarksTimer;
const onBookmarksChanged = () => {
  clearTimeout(bookmarksTimer);
  bookmarksTimer = setTimeout(() => loadStarred().then(render), 200);
};
for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) api.bookmarks?.[ev]?.addListener(onBookmarksChanged);
// Downloads: refresh the list and sheet when anything starts, changes or is removed.
const onDownloadsChanged = () => {
  clearTimeout(onDownloadsChanged.t);
  onDownloadsChanged.t = setTimeout(async () => {
    await loadDownloads();
    renderDownloads();
    if (state.query) render();
  }, 150);
};
api.downloads?.onCreated?.addListener(onDownloadsChanged);
api.downloads?.onChanged?.addListener(onDownloadsChanged);
api.downloads?.onErased?.addListener(onDownloadsChanged);
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.keys(changes).some((k) => k.startsWith(THUMB_PREFIX))) scheduleRefresh();
});

// Coming back to the Tabie tab: show fresh data and focus the search box.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refresh();
    queryEl.focus();
  }
});

// ---------- init ----------

(async function init() {
  const stored = await api.storage.local.get(PREFS_KEY);
  const prefs = stored[PREFS_KEY] || {};
  if (SORTS.includes(prefs.sort)) state.sort = prefs.sort;
  if (GROUPS.includes(prefs.group)) state.group = prefs.group;
  if (prefs.layout === "list" || prefs.layout === "cards") state.layout = prefs.layout;
  if (THEMES.includes(prefs.theme)) state.theme = prefs.theme;
  if (ENGINES[prefs.engine]) state.engine = prefs.engine;
  $("#engine").value = state.engine;
  applyTheme(state.theme);
  syncControls();

  try {
    state.selfTabId = (await api.tabs.getCurrent())?.id ?? null;
  } catch {
    // Not running in a tab (side panel).
  }
  await loadRecentSearches();
  await loadTabs();
  await loadStarred(); // after tabs, so moving old stars can use tab titles
  render();
  // In the side panel the first card is the tab you're on, so start on the one
  // before it and Enter flips back. As a page, the first card is where you came from.
  if (!state.selfTabId && state.sort === "recent" && state.items[1] && state.items[0].id === state.currentTabId) {
    state.cursor = 1;
    paintCursor();
  }
  queryEl.focus();
  // First real frame is ready: fade the UI in (see boot.js).
  requestAnimationFrame(() => document.documentElement.classList.remove("booting"));
})();
