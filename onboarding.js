// Tabie onboarding: a short guided tour with hand-drawn scribbles and arrows.
//
// Self-contained module. popup.js doesn't know it exists; it only needs
// onboarding.css and this file to be loaded by popup.html. To remove onboarding
// from the codebase, delete both files and their two tags in popup.html.
//
// Behaviour:
//   - New user (no saved state): the tour starts automatically.
//   - Skip or finish: saved, so it doesn't start on its own again.
//   - A "Learn" button in the footer restarts the tour at any time, as does any
//     element with data-start-tour (e.g. "Learn More" on the empty screen).
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = "onboarding"; // undefined | "skipped" | "done"
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl+";
  const alt = isMac ? "⌥" : "Alt+";

  const STEPS = [
    {
      target: null,
      title: "Welcome to Tabie",
      body: "I can manage the 1000+ tabs you open. Let's take a quick 20-second tour.",
      logo: true,
    },
    {
      target: "#q",
      title: "Browse anything",
      body: "Find open tabs, closed tabs and downloads, or search Google.",
    },
    {
      target: "#toggle-history",
      title: "Your safety net",
      body: `Closed something by mistake? It's in here. ${alt}H`,
    },
    {
      target: "#starred",
      title: "Shortcuts",
      body: "Star the tabs you love. They live here.",
    },
    {
      target: "#toggle-downloads",
      title: "Downloads",
      body: `Every file you've downloaded, one click away. ${alt}D`,
    },
    {
      target: ".statusbar .actions",
      title: "One-click tidy",
      body: "Super Clean duplicates and old tabs, rest idle tabs, or let Magic Tabs sort things out.",
    },
    {
      target: "#show-shortcuts",
      title: "Fly with your keyboard",
      body: `${alt}T jumps to Tabie from any site. ${mod}K shows every shortcut.`,
    },
    {
      target: null,
      celebrate: true,
      logo: true,
      title: "Congratulations!",
      body: "You've learned Tabie. Happy browsing!",
    },
  ];

  // The Tabie mark: four squares on a rounded tile.
  const LOGO = `<svg class="ob-logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="1.5" y="1.5" width="61" height="61" rx="15" fill="#fff"/>
      <g fill="#1d1d1f"><rect x="15" y="15" width="15" height="15" rx="2.5"/><rect x="34" y="15" width="15" height="15" rx="2.5"/>
      <rect x="15" y="34" width="15" height="15" rx="2.5"/><rect x="34" y="34" width="15" height="15" rx="2.5"/></g>
    </svg>`;

  let root = null; // overlay element while the tour is running
  let steps = [];
  let index = 0;

  // ---------- state ----------

  async function getState() {
    try {
      return (await api.storage.local.get(KEY))[KEY];
    } catch {
      return "done"; // if storage fails, stay out of the way
    }
  }

  const setState = (value) => api.storage.local.set({ [KEY]: value }).catch(() => {});

  // ---------- footer entry ----------

  function addFooterButton() {
    if (document.querySelector(".ob-footer-btn")) return;
    const actions = document.querySelector(".statusbar .actions");
    if (!actions) return;
    const btn = document.createElement("button");
    btn.className = "action-btn ob-footer-btn";
    btn.title = "Take the Tabie tour";
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a4.5 4.5 0 0 1 2.6 8.2V11.5H5.4V9.7A4.5 4.5 0 0 1 8 1.5zM5.5 12.75h5V14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z"/></svg><span>Learn</span>';
    btn.addEventListener("click", start);
    actions.append(btn);
  }

  // ---------- hand-drawn shapes ----------

  // Small deterministic wobble so the scribbles look hand-drawn but don't
  // jump around when the window is resized.
  function wobble(seed) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280 - 0.5;
    };
  }

  // A loose loop around a box, drawn a little more than once, like a pen circle.
  function scribbleLoop(r, seed) {
    const rnd = wobble(seed);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rx = r.width / 2 + 14;
    const ry = r.height / 2 + 12;
    const turns = 1.12;
    const n = 48;
    let d = "";
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2 * turns;
      const k = 1 + rnd() * 0.06 + (i / n) * 0.05;
      const x = cx + Math.cos(a) * rx * k;
      const y = cy + Math.sin(a) * ry * k;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }

  // A curved arrow from (x1,y1) to (x2,y2), with a two-stroke arrowhead.
  function scribbleArrow(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(80, len * 0.35) * (dx >= 0 ? 1 : -1);
    const nx = -dy / len;
    const ny = dx / len;
    const c1x = x1 + dx * 0.25 + nx * bend;
    const c1y = y1 + dy * 0.25 + ny * bend;
    const c2x = x1 + dx * 0.8 + nx * bend * 0.4;
    const c2y = y1 + dy * 0.8 + ny * bend * 0.4;
    const curve = `M${x1} ${y1} C${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`;
    // Arrowhead follows the curve's final direction.
    const ang = Math.atan2(y2 - c2y, x2 - c2x);
    const h = 13;
    const a1 = ang + Math.PI * 0.82;
    const a2 = ang - Math.PI * 0.82;
    const head = `M${x2 + Math.cos(a1) * h} ${y2 + Math.sin(a1) * h} L${x2} ${y2} L${x2 + Math.cos(a2) * h} ${y2 + Math.sin(a2) * h}`;
    return { curve, head };
  }

  // ---------- tour ----------

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-start-tour]")) start();
  });

  function start() {
    if (root) return;
    // Skip steps whose target isn't on screen (e.g. the footer in the narrow side panel).
    steps = STEPS.filter((s) => !s.target || visible(document.querySelector(s.target)));
    index = 0;
    root = document.createElement("div");
    root.className = "ob-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Tabie tour");
    document.body.append(root);
    document.activeElement?.blur?.();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", draw);
    draw();
  }

  function stop() {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", draw);
    // Fade out instead of vanishing abruptly.
    const leaving = root;
    root = null;
    leaving?.classList.add("ob-leaving");
    setTimeout(() => leaving?.remove(), 280);
    document.querySelector("#q")?.focus();
  }

  // Falling paper confetti for the final screen (no purple, to match Tabie).
  function confetti(container) {
    const colors = ["#ffcc00", "#ff9f0a", "#ff6b5b", "#34c759", "#30b0c7", "#0a84ff", "#ffffff", "#f5e6c8"];
    const layer = document.createElement("div");
    layer.className = "ob-confetti";
    const count = Math.min(160, Math.round(innerWidth / 9));
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("i");
      const w = 6 + Math.random() * 6;
      piece.style.cssText = [
        `left:${Math.random() * 100}%`,
        `width:${w}px`,
        `height:${Math.random() < 0.25 ? w : w * (1.4 + Math.random())}px`,
        `background:${colors[i % colors.length]}`,
        `border-radius:${Math.random() < 0.25 ? "50%" : "2px"}`,
        `--drift:${(Math.random() - 0.5) * 220}px`,
        `--spin:${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720)}deg`,
        `animation-duration:${2.6 + Math.random() * 2.2}s`,
        `animation-delay:${Math.random() * 0.9}s`,
      ].join(";");
      layer.append(piece);
    }
    container.append(layer);
  }

  function skip() {
    setState("skipped");
    stop();
  }

  function finish() {
    setState("done");
    stop();
  }

  function go(d) {
    const next = index + d;
    if (next < 0) return;
    if (next >= steps.length) return finish();
    index = next;
    draw();
  }

  // Keys go to the tour only, so nothing behind it reacts while it's open.
  function onKey(e) {
    e.stopImmediatePropagation();
    // Enter or Space on a focused tour button just presses that button.
    if ((e.key === "Enter" || e.key === " ") && e.target.closest?.(".ob-btn")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      skip();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key !== "Tab") {
      e.preventDefault();
    }
  }

  function draw() {
    if (!root) return;
    const step = steps[index];
    const el = step.target && document.querySelector(step.target);
    const W = innerWidth;
    const H = innerHeight;
    const last = index === steps.length - 1;
    const dots = steps.map((_, i) => `<span class="ob-dot${i === index ? " on" : ""}"></span>`).join("");

    root.innerHTML = `
      <div class="ob-shade${el ? "" : " full"}"></div>
      ${el ? '<div class="ob-spot"></div>' : ""}
      <svg class="ob-ink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"></svg>
      <div class="ob-note${el ? "" : " welcome"}">
        ${step.logo ? LOGO : ""}
        <div class="ob-title">${step.title}</div>
        <div class="ob-body">${step.body}</div>
        <div class="ob-bar">
          <div class="ob-dots">${dots}</div>
          <div class="ob-buttons">
            ${last ? "" : '<button class="ob-btn ghost" data-ob="skip">Skip</button>'}
            ${index ? '<button class="ob-btn ghost" data-ob="back">Back</button>' : ""}
            <button class="ob-btn primary" data-ob="next">${last ? "Let's go" : index ? "Next" : "Start"}</button>
          </div>
        </div>
      </div>`;

    root.querySelector('[data-ob="skip"]')?.addEventListener("click", skip);
    root.querySelector('[data-ob="back"]')?.addEventListener("click", () => go(-1));
    root.querySelector('[data-ob="next"]').onclick = () => go(1);

    const note = root.querySelector(".ob-note");
    const ink = root.querySelector(".ob-ink");
    const nw = note.offsetWidth;
    const nh = note.offsetHeight;

    if (step.celebrate) confetti(root);
    if (!el) {
      // Welcome and the final congratulations: a centred note, no ink.
      Object.assign(note.style, { left: `${(W - nw) / 2}px`, top: `${H * 0.4 - nh / 2}px` });
      return;
    }

    el.scrollIntoView?.({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(root.querySelector(".ob-spot").style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });

    // Put the note on the roomier side of the target, nudged towards the centre
    // so the arrow has room to curve.
    const below = r.top + r.height / 2 < H / 2;
    const gap = 96;
    const cx = r.left + r.width / 2;
    const towardCentre = cx < W / 2 ? 70 : -70;
    const left = Math.max(16, Math.min(W - nw - 16, cx - nw / 2 + towardCentre));
    const top = below
      ? Math.min(H - nh - 16, r.bottom + gap)
      : Math.max(16, r.top - gap - nh);
    Object.assign(note.style, { left: `${left}px`, top: `${top}px` });

    // Arrow from the note's edge to just outside the scribbled loop.
    const sx = left + nw / 2 - towardCentre * 0.6;
    const sy = below ? top - 10 : top + nh + 10;
    const ex = cx;
    const ey = below ? r.bottom + 22 : r.top - 22;
    const arrow = scribbleArrow(sx, sy, ex, ey);
    ink.innerHTML = `
      <path class="ob-stroke draw" d="${scribbleLoop(r, index * 97 + 13)}"/>
      <path class="ob-stroke draw delay1" d="${arrow.curve}"/>
      <path class="ob-stroke draw delay2" d="${arrow.head}"/>`;
    animate(ink);
  }

  // Draw each stroke like a pen: dash = its own length, then animate to 0.
  function animate(svg) {
    svg.querySelectorAll(".draw").forEach((p) => {
      const len = Math.ceil(p.getTotalLength());
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    });
  }

  // ---------- boot ----------

  // Wait until popup.js has rendered (boot.js removes "booting"), then decide.
  function whenReady(fn) {
    const check = () => (document.documentElement.classList.contains("booting") ? setTimeout(check, 50) : fn());
    check();
  }

  whenReady(async () => {
    addFooterButton(); // "Learn" is always available
    const state = await getState();
    if (state === "done" || state === "skipped") return;
    setTimeout(start, 350); // new user: start after the UI has faded in
  });
})();
