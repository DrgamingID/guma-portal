/* Latar interaktif: partikel + simbol matematika yang bereaksi pada kursor */
(function () {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SYMBOLS = ['∑', '∫', 'π', '∞', '√', '∂', 'Δ', 'θ', 'λ', '≈', '∇', 'ℝ', 'ℕ', 'ℤ', 'φ', 'Ω'];
  let w, h, dpr, parts = [], mouse = { x: -999, y: -999 }, running = true;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    const n = Math.min(70, Math.floor(innerWidth * innerHeight / 22000));
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .25 * dpr, vy: (Math.random() - .5) * .25 * dpr,
      r: (Math.random() * 1.4 + .6) * dpr,
      sym: Math.random() < .3 ? SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)] : null,
      size: (14 + Math.random() * 18) * dpr, a: .12 + Math.random() * .25
    }));
  }

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);
    const mx = mouse.x * dpr, my = mouse.y * dpr, link = 130 * dpr;
    for (const p of parts) {
      const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy, R = 150 * dpr;
      if (d2 < R * R) { const d = Math.sqrt(d2) || 1, f = (1 - d / R) * .6; p.vx += dx / d * f * .1; p.vy += dy / d * f * .1; }
      p.vx *= .99; p.vy *= .99;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      if (p.sym) { ctx.font = `${p.size}px "Cambria Math", serif`; ctx.fillStyle = `rgba(196,181,253,${p.a})`; ctx.fillText(p.sym, p.x, p.y); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fillStyle = 'rgba(167,139,250,.65)'; ctx.fill(); }
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j]; if (a.sym || b.sym) continue;
        const dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy;
        if (d < link * link) {
          ctx.strokeStyle = `rgba(139,92,246,${(1 - Math.sqrt(d) / link) * .28})`; ctx.lineWidth = dpr * .8;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running && !reduce) requestAnimationFrame(frame); });
  resize(); frame();
})();
