// Solo mode for the browser: goonyjump normally needs server.py for /info and /ws.
// This stands in for the server so game.js runs unchanged on a static host.
(function () {
  const realFetch = window.fetch.bind(window);
  let hall = null;
  const loadHall = () => hall || (hall = realFetch("hall.json").then(r => r.json())
    .then(o => Object.values(o).sort((a, b) => (b.lvl || 1) - (a.lvl || 1)).slice(0, 12))
    .catch(() => []));

  window.fetch = function (url, opts) {
    if (typeof url === "string" && /(^|\/)info$/.test(url)) {
      return loadHall().then(seen => new Response(JSON.stringify(
        { ip: "solo", ips: ["solo"], port: 0, players: [], seen }),
        { headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(url, opts);
  };

  class SoloSocket {
    constructor() {
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30);
    }
    reply(msg) {
      setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(msg) }), 0);
    }
    send(raw) {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      const seed = () => 1 + Math.floor(Math.random() * 2147483646);
      if (m.t === "join") {
        this.reply({ t: "welcome", id: 1, seed: seed(), players: {}, host: false, admin: { time: 1, grav: 1 } });
      } else if (m.t === "restart") {
        this.reply({ t: "restart", seed: seed() });
      }
    }
    close() {
      this.readyState = 3;
      this.onclose && this.onclose();
    }
  }
  window.WebSocket = SoloSocket;

  // The lobby shows LAN join addresses; replace them with solo-mode info.
  const SOLO_INFO = 'solo browser mode 🕹️ no friends required (or available).<br>' +
    'for co-op with phones, run the real server: ' +
    '<a href="https://github.com/gigacook/goonyjump" style="color:#ffe066">github.com/gigacook/goonyjump</a><br>' +
    '<a href="/" style="color:#9aa4e8">← back to the terminal</a>';
  document.addEventListener("DOMContentLoaded", () => {
    const info = document.getElementById("joinInfo");
    const active = document.getElementById("activeGame");
    const fix = () => {
      if (info && !info.innerHTML.includes("solo browser mode")) info.innerHTML = SOLO_INFO;
      if (active && /LIVE TOWER|tower is empty|checking/.test(active.textContent))
        active.textContent = "🏆 podium = Season 1 Hall of Goon legends";
    };
    // Each fix() write re-triggers the observers once, then the checks above stop it.
    if (info) new MutationObserver(fix).observe(info, { childList: true });
    if (active) new MutationObserver(fix).observe(active, { childList: true });
    fix();

    // ?go (used by the terminal) skips the lobby and drops straight into a run.
    // Your saved name/look/stats are used; ESC still brings the lobby back.
    const params = new URLSearchParams(location.search);
    if (params.has("go")) {
      history.replaceState(null, "", location.pathname);
      const btn = document.getElementById("playBtn");
      if (btn) setTimeout(() => btn.click(), 0);
    }
  });
})();
