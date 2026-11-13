(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const scoreEl = $("score");
  const bestEl = $("best");

  const load = (src) => { const img = new Image(); img.src = src; return img; };
  const IMG = {
    diego: load("assets/diego.png"),
    bolsa: load("assets/bolsa.png"),
    guardia: load("assets/guardia.png"),
  };

  let W = 0, H = 0, DPR = 1, unit = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    unit = Math.min(W, H * 0.75) / 100; // tamaño base que se adapta a celular y escritorio
    if (player) {
      player.r = unit * 9;
      player.y = H - player.r - Math.max(24, unit * 6);
      player.x = Math.min(Math.max(player.x, player.r), W - player.r);
    }
  }

  let best = 0;
  try { best = Number(localStorage.getItem("diego-palacio-best")) || 0; } catch {}
  bestEl.textContent = best;

  // ---------- Estado ----------
  let player = null;
  let items = [];
  let particles = [];
  let popups = [];
  let score = 0;
  let elapsed = 0;
  let spawnTimer = 0;
  let running = false;
  let lastTime = 0;
  let targetX = null;
  const keys = { left: false, right: false };

  function reset() {
    player = { x: W / 2, y: 0, r: 0, squash: 0, hit: 0 };
    resize();
    items = [];
    particles = [];
    popups = [];
    score = 0;
    elapsed = 0;
    spawnTimer = 0.4;
    targetX = null;
    scoreEl.textContent = "0";
  }

  // Dificultad: todo acelera poco a poco y los guardias aparecen más seguido.
  const speedBase = () => (H * 0.32) * (1 + elapsed / 40);
  const spawnEvery = () => Math.max(0.32, 0.95 - elapsed * 0.012);
  const guardChance = () => Math.min(0.42, 0.18 + elapsed * 0.006);

  function spawn() {
    const isGuard = elapsed > 2 && Math.random() < guardChance();
    const size = isGuard ? unit * 8 : unit * 8.5;
    items.push({
      type: isGuard ? "guardia" : "bolsa",
      x: size + Math.random() * (W - size * 2),
      y: -size * 1.5,
      size,
      vy: speedBase() * (0.8 + Math.random() * 0.5),
      vx: isGuard ? (Math.random() - 0.5) * unit * 6 : 0,
      rot: (Math.random() - 0.5) * 0.6,
      spin: (Math.random() - 0.5) * 2,
      sway: Math.random() * Math.PI * 2,
    });
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = unit * (10 + Math.random() * 30);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - unit * 15, life: 1, color, r: unit * (0.5 + Math.random()) });
    }
  }

  function bumpScore() {
    scoreEl.textContent = score;
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("bump");
  }

  // ---------- Bucle ----------
  function update(dt) {
    elapsed += dt;

    // Movimiento del jugador
    const speed = W * 1.3;
    if (keys.left || keys.right) {
      targetX = null;
      player.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * speed * dt;
    } else if (targetX !== null) {
      player.x += (targetX - player.x) * Math.min(1, dt * 18);
    }
    player.x = Math.min(Math.max(player.x, player.r), W - player.r);
    player.squash = Math.max(0, player.squash - dt * 4);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = spawnEvery() * (0.7 + Math.random() * 0.6);
    }

    for (const it of items) {
      it.sway += dt * 3;
      it.y += it.vy * dt;
      it.x += (it.vx + (it.type === "bolsa" ? Math.sin(it.sway) * unit * 8 : 0)) * dt;
      if (it.x < it.size || it.x > W - it.size) it.vx *= -1;
      it.rot += it.spin * dt * (it.type === "bolsa" ? 0.4 : 1);

      // Choque: círculos algo más chicos que la imagen para que se sienta justo
      const dx = it.x - player.x;
      const dy = it.y - player.y;
      const reach = player.r * 0.85 + it.size * (it.type === "guardia" ? 0.7 : 0.8);
      if (dx * dx + dy * dy < reach * reach) {
        if (it.type === "guardia") return gameOver(it);
        it.dead = true;
        score += 1;
        player.squash = 1;
        bumpScore();
        burst(it.x, it.y, "#f2b705", 14);
        popups.push({ x: it.x, y: it.y - it.size, life: 1, text: "+1" });
      }
      if (it.y - it.size > H) it.dead = true;
    }
    items = items.filter((it) => !it.dead);

    for (const p of particles) {
      p.life -= dt * 1.4;
      p.vy += unit * 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) { p.life -= dt * 1.2; p.y -= unit * 20 * dt; }
    popups = popups.filter((p) => p.life > 0);
  }

  function drawImage(img, x, y, w, h, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Línea de piso
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, player.y + player.r + 8);
    ctx.lineTo(W, player.y + player.r + 8);
    ctx.stroke();

    for (const it of items) {
      if (it.type === "guardia") {
        ctx.save();
        ctx.shadowColor = "rgba(255, 60, 60, 0.75)";
        ctx.shadowBlur = unit * 4;
        drawImage(IMG.guardia, it.x, it.y, it.size * 2, it.size * 2, it.rot);
        ctx.restore();
      } else {
        drawImage(IMG.bolsa, it.x, it.y, it.size * 2, it.size * 2 * 0.86, it.rot);
      }
    }

    // Diego con brillo blanco y rebote al atrapar
    const s = player.squash;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.scale(1 + s * 0.15, 1 - s * 0.12);
    ctx.shadowColor = player.hit ? "rgba(255,60,60,0.9)" : "rgba(255,255,255,0.55)";
    ctx.shadowBlur = unit * (3 + s * 4);
    ctx.beginPath();
    ctx.arc(0, 0, player.r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowBlur = 0;
    if (IMG.diego.complete) ctx.drawImage(IMG.diego, -player.r, -player.r, player.r * 2, player.r * 2);
    ctx.restore();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = `800 ${Math.round(unit * 6)}px "Bricolage Grotesque", Arial, sans-serif`;
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - lastTime) / 1000 || 0);
    lastTime = t;
    update(dt);
    draw();
    if (running) requestAnimationFrame(frame);
  }

  function start() {
    reset();
    $("start").hidden = true;
    $("over").hidden = true;
    $("hud").hidden = false;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  function gameOver(guard) {
    running = false;
    player.hit = 1;
    burst(player.x, player.y, "#ff3c3c", 30);
    burst(guard.x, guard.y, "#ffffff", 16);
    // Pequeña animación de choque antes de mostrar la pantalla final
    let t = 0;
    const shake = () => {
      t += 1 / 60;
      for (const p of particles) { p.life -= 1 / 60; p.vy += unit; p.x += p.vx / 60; p.y += p.vy / 60; }
      particles = particles.filter((p) => p.life > 0);
      ctx.save();
      ctx.translate((Math.random() - 0.5) * unit * 3 * (1 - t), (Math.random() - 0.5) * unit * 3 * (1 - t));
      draw();
      ctx.restore();
      if (t < 0.7) requestAnimationFrame(shake); else showOver();
    };
    requestAnimationFrame(shake);
  }

  function showOver() {
    const isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem("diego-palacio-best", String(best)); } catch {}
      bestEl.textContent = best;
    }
    $("final-score").textContent = score;
    $("new-best").hidden = !isBest;
    $("hud").hidden = true;
    const over = $("over");
    over.hidden = false;
    // Reinicia las animaciones de las letras
    over.querySelectorAll(".ch, .fade").forEach((el) => {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    });
    $("again").focus();
  }

  // ---------- Controles ----------
  function pointerTo(e) {
    if (!running) return;
    targetX = e.clientX;
  }
  canvas.addEventListener("pointerdown", (e) => { pointerTo(e); canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    // Con mouse sigue al cursor; con el dedo solo mientras toca la pantalla
    if (e.pointerType === "mouse" || e.buttons || e.pressure > 0) pointerTo(e);
  });

  const KEYMAP = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  window.addEventListener("keydown", (e) => {
    if (KEYMAP[e.key]) { keys[KEYMAP[e.key]] = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (KEYMAP[e.key]) keys[KEYMAP[e.key]] = false;
  });
  window.addEventListener("blur", () => { keys.left = keys.right = false; });

  $("play").addEventListener("click", start);
  $("again").addEventListener("click", start);
  window.addEventListener("resize", () => { resize(); if (!running && player) draw(); });

  // Fondo de la portada: bolsas cayendo detrás del menú
  reset();
  (function attract(t) {
    if (running) return;
    if (!$("start").hidden) {
      const dt = Math.min(0.05, (t - (attract.last || t)) / 1000);
      attract.last = t;
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawn(); items[items.length - 1].type = "bolsa"; spawnTimer = 0.5; }
      for (const it of items) { it.y += it.vy * dt; it.rot += it.spin * dt * 0.4; }
      items = items.filter((it) => it.y - it.size < H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.5;
      for (const it of items) drawImage(IMG.bolsa, it.x, it.y, it.size * 2, it.size * 2 * 0.86, it.rot);
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(attract);
  })(performance.now());
})();
