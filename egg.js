// ↑ ↑ ↓ ↓ ← → ← → B A  (or tap the logo 7 times) → GOON JET
(function () {
  const CODE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  let pos = 0, taps = 0, tapTimer = null, flying = false;

  addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    pos = k === CODE[pos] ? pos + 1 : (k === CODE[0] ? 1 : 0);
    if (pos === CODE.length) { pos = 0; goonJet(); }
  });

  window.eggTap = function () {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 1500);
    if (taps >= 7) { taps = 0; goonJet(); }
  };

  function goonJet() {
    if (flying) return;
    flying = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
    document.body.appendChild(layer);

    const banner = document.createElement("div");
    banner.textContent = "💦 GOON JET UNLOCKED 💦";
    banner.style.cssText = "position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) rotate(-4deg);" +
      "font:800 clamp(22px,6vw,56px)/1.1 system-ui,sans-serif;color:#ffe066;white-space:nowrap;" +
      "text-shadow:3px 3px 0 #ff6ad5,6px 6px 0 #4b56a8;transition:opacity .6s";
    layer.appendChild(banner);

    const jet = document.createElement("div");
    jet.textContent = "🧍";
    jet.style.cssText = "position:absolute;left:50%;bottom:-80px;font-size:64px;transform:translateX(-50%)";
    layer.appendChild(jet);

    const start = performance.now(), dur = reduce ? 1 : 2200;
    const W = innerWidth, H = innerHeight;
    (function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const y = -80 + (H + 200) * (t * t);
      const x = W / 2 + Math.sin(t * 18) * 40 * (1 - t);
      jet.style.bottom = y + "px";
      jet.style.left = x + "px";
      if (!reduce && Math.random() < 0.7) {
        const drop = document.createElement("div");
        drop.textContent = "💦";
        const dx = (Math.random() - 0.5) * 60;
        drop.style.cssText = `position:absolute;left:${x + dx}px;bottom:${y - 30}px;font-size:${18 + Math.random() * 20}px;` +
          "transition:transform 1.1s ease-in,opacity 1.1s";
        layer.appendChild(drop);
        requestAnimationFrame(() => {
          drop.style.transform = `translate(${dx * 2}px, ${140 + Math.random() * 160}px) rotate(${dx * 4}deg)`;
          drop.style.opacity = "0";
        });
        setTimeout(() => drop.remove(), 1200);
      }
      if (t < 1) requestAnimationFrame(tick);
      else {
        banner.style.opacity = "0";
        setTimeout(() => { layer.remove(); flying = false; }, reduce ? 1500 : 1300);
      }
    })(start);
    if (window.onGoonJet) window.onGoonJet();
  }
})();
