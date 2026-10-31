// Runs in <head>, before the first paint. Applies the saved theme and keeps the
// UI hidden until popup.js has rendered the real content, so reloading Tabie
// doesn't flash default states (wrong theme, empty grid, default menu labels).
(function () {
  var root = document.documentElement;
  root.classList.add("booting");
  try {
    var theme = localStorage.getItem("tabie-theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  } catch (e) {
    // storage blocked: popup.js applies the synced theme instead
  }
  // Failsafe: never stay hidden if something goes wrong during start-up.
  setTimeout(function () {
    root.classList.remove("booting");
  }, 1500);
})();
