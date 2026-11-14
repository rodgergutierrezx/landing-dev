(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Catálogo ----------
  const FOODS = [
    { id: "fat_bistec_chilaquiles_rojos", name: "Bistec con chilaquiles rojos", kind: "fat" },
    { id: "fat_chilaquiles_verdes", name: "Chilaquiles verdes", kind: "fat" },
    { id: "fat_coctel_camaron", name: "Coctel de camarón", kind: "fat" },
    { id: "fat_elote_preparado", name: "Elote preparado", kind: "fat" },
    { id: "fat_empanada_camaron", name: "Empanada de camarón", kind: "fat" },
    { id: "fat_sopa_instantanea", name: "Sopa instantánea", kind: "fat" },
    { id: "fit_apio", name: "Apio", kind: "fit" },
    { id: "fit_brocoli", name: "Brócoli", kind: "fit" },
    { id: "fit_jitomate", name: "Jitomate", kind: "fit" },
    { id: "fit_platano", name: "Plátano", kind: "fit" },
    { id: "fit_zanahoria", name: "Zanahoria", kind: "fit" },
  ];
  const FAT = FOODS.filter((f) => f.kind === "fat");
  const FIT = FOODS.filter((f) => f.kind === "fit");
  const foodSrc = (f) => `assets/comida/${f.id}.webp`;

  // Niveles: -5 (delgado_5) … 0 (normal) … +5 (gordo_5)
  const faceFile = (lvl) => lvl === 0 ? "normal" : lvl < 0 ? `delgado_${-lvl}` : `gordo_${lvl}`;
  const faceSrc = (lvl) => `assets/cara/${faceFile(lvl)}.webp`;

  // Barra de salud: 9 etapas repartidas sobre los 11 niveles
  const STAGES = ["Desnutrición", "Anemia", "Delgadez", "Normal", "Distensión", "Sobrepeso", "Obesidad", "Diabetes", "Infarto"];
  const STAGE_OF = { "-5": 0, "-4": 0, "-3": 1, "-2": 2, "-1": 2, "0": 3, "1": 4, "2": 5, "3": 6, "4": 7, "5": 8 };
  const levelLabel = (lvl) => lvl === 0 ? "Nivel normal" : lvl < 0 ? `Delgado ${-lvl} / 5` : `Gordo ${lvl} / 5`;

  // Precarga de imágenes
  for (let l = -5; l <= 5; l++) new Image().src = faceSrc(l);
  for (const f of FOODS) new Image().src = foodSrc(f);

  // ---------- Sonido ----------
  // Se usa Web Audio: los sonidos se descargan y decodifican una vez y se
  // reproducen al instante desde memoria. Safari en iPhone falla a menudo con
  // <audio> (no precarga, cancela al reiniciar y se suspende al cambiar de app).
  const SND = { eat: "assets/sonidos/comiendo.mp3", no: "assets/sonidos/no.mp3" };
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  const buffers = {};
  const playing = new Set();
  const fallback = {};
  let muted = false;
  try { muted = localStorage.getItem("ari-muted") === "1"; } catch {}

  // En iOS 16.4+ esto hace que el juego suene aunque el switch de silencio esté activado
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}

  function decode(ctx, data) {
    // Safari viejo solo acepta la versión con callbacks
    return new Promise((res, rej) => {
      const p = ctx.decodeAudioData(data, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  function loadSounds() {
    if (!AC || actx) return;
    actx = new AC();
    for (const [name, url] of Object.entries(SND)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => decode(actx, data))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => {});
    }
  }

  // Debe llamarse dentro de un toque: iOS solo deja activar el audio así,
  // y lo vuelve a suspender al bloquear el celular o cambiar de app.
  function unlockAudio() {
    loadSounds();
    if (!actx) return;
    if (actx.state !== "running") actx.resume().catch(() => {});
    // Un sonido vacío dentro del gesto termina de desbloquear Safari
    try {
      const src = actx.createBufferSource();
      src.buffer = actx.createBuffer(1, 1, 22050);
      src.connect(actx.destination);
      src.start(0);
    } catch {}
  }

  function play(name) {
    if (muted) return;
    if (actx && buffers[name]) {
      if (actx.state !== "running") actx.resume().catch(() => {});
      const src = actx.createBufferSource();
      src.buffer = buffers[name];
      src.connect(actx.destination);
      src.onended = () => playing.delete(src);
      playing.add(src);
      src.start(0);
      return;
    }
    // Respaldo si Web Audio no existe o el sonido aún no termina de cargar
    const a = fallback[name] || (fallback[name] = new Audio(SND[name]));
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  function stopSounds() {
    for (const src of playing) { try { src.stop(); } catch {} }
    playing.clear();
    for (const a of Object.values(fallback)) { try { a.pause(); } catch {} }
  }

  // Cada toque reactiva el audio por si iOS lo suspendió
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("touchend", unlockAudio, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && actx && actx.state !== "running") actx.resume().catch(() => {});
  });

  // ---------- Estado ----------
  let level = 0;
  let fatNeeded = 0; // comidas fat que faltan para engordar un nivel
  let fitNeeded = 0; // comidas fit que faltan para adelgazar un nivel
  let current = null;
  let busy = false;

  function newCounters() {
    fatNeeded = rand(2, 4);
    fitNeeded = rand(2, 4);
  }

  // Probabilidad de que salga comida fat: más alta cuando ARI está delgado
  function fatChance() {
    return level < 0 ? 0.55 + (-level) * 0.07 : 0.5;
  }
  // Probabilidad de rechazar comida fit: nunca si está delgado, más alta entre más gordo
  function rejectChance(food) {
    if (food.kind === "fat") return 0; // ARI prefiere la comida fat
    if (level < 0) return 0;
    if (level === 0) return 0.25;
    return Math.min(0.75, 0.3 + level * 0.09); // gordo_1 ≈ 39% … gordo_5 = 75%
  }

  function nextFood() {
    const pool = Math.random() < fatChance() ? FAT : FIT;
    let f = pick(pool);
    if (current && f.id === current.id) f = pick(pool.filter((x) => x.id !== current.id));
    current = f;
    const img = $("food");
    img.className = "food";
    img.style.transform = "";
    img.style.opacity = "";
    img.src = foodSrc(f);
    img.alt = f.name;
    void img.offsetWidth;
    img.classList.add("enter");
    $("food-name").textContent = f.name;
    const k = $("kind");
    k.textContent = f.kind.toUpperCase();
    k.className = `kind ${f.kind}`;
  }

  // ---------- Pintar estado ----------
  const ticks = $("ticks");
  STAGES.forEach((s) => { const el = document.createElement("span"); el.textContent = s; ticks.appendChild(el); });

  function renderHealth(animate) {
    const stage = STAGE_OF[level];
    const stageEl = $("stage");
    if (stageEl.textContent !== STAGES[stage] && animate) {
      stageEl.classList.remove("pop"); void stageEl.offsetWidth; stageEl.classList.add("pop");
    }
    stageEl.textContent = STAGES[stage];
    $("level-tag").textContent = levelLabel(level);
    $("bar-fill").style.width = `${((level + 5) / 10) * 92 + 8}%`;
    const bar = $("bar");
    bar.setAttribute("aria-valuenow", String(level + 5));
    bar.setAttribute("aria-valuetext", STAGES[stage]);
    bar.dataset.zone = Math.abs(level) === 5 ? "extreme" : level > 0 ? "bad" : level < 0 ? "thin" : "ok";
    [...ticks.children].forEach((el, i) => el.classList.toggle("on", i === stage));
  }

  let faceFront = $("face-a"), faceBack = $("face-b");
  function setFace(lvl) {
    faceBack.src = faceSrc(lvl);
    const show = () => {
      faceBack.classList.remove("out");
      faceFront.classList.add("out");
      [faceFront, faceBack] = [faceBack, faceFront];
    };
    if (faceBack.complete) show(); else faceBack.onload = show;
  }

  function flash(type) {
    const el = $("flash");
    el.className = "flash";
    void el.offsetWidth;
    el.classList.add(type);
  }

  function gesture(name) {
    const face = $("face");
    face.classList.remove("yes", "no", "grow");
    void face.offsetWidth;
    face.classList.add(name);
  }

  function say(text) {
    const b = $("bubble");
    b.textContent = text;
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
  }

  function crumbs(x, y, kind) {
    const colors = kind === "fat" ? ["#ffb020", "#ff5a2d", "#fff3c4"] : ["#22e06b", "#ff8a2d", "#e8ffe0"];
    for (let i = 0; i < 14; i++) {
      const c = document.createElement("span");
      c.className = "crumb";
      c.style.background = pick(colors);
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      document.body.appendChild(c);
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 70;
      c.animate(
        [{ transform: "translate(0,0) scale(1)", opacity: 1 },
         { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 40}px) scale(.3)`, opacity: 0 }],
        { duration: 700 + Math.random() * 300, easing: "cubic-bezier(.2,.8,.4,1)" }
      ).onfinish = () => c.remove();
    }
  }

  // ---------- Reglas al comer ----------
  function eat(food) {
    play("eat");
    gesture("yes");
    say(food.kind === "fat" ? "¡Ñam ñam!" : "Mmm, sano");
    let change = 0;
    if (food.kind === "fat") {
      fatNeeded -= 1;
      if (fatNeeded <= 0) change = level < 5 ? 1 : 0;
    } else {
      fitNeeded -= 1;
      if (fitNeeded <= 0) change = level > -5 ? -1 : 0;
    }
    if ((food.kind === "fat" && fatNeeded <= 0) || (food.kind === "fit" && fitNeeded <= 0)) newCounters();

    setTimeout(() => {
      if (change) {
        level += change;
        setFace(level);
        gesture("grow");
        flash(change > 0 ? "bad" : "good");
        say(change > 0 ? "¡Engordó!" : "¡Adelgazó!");
        if (navigator.vibrate) navigator.vibrate(change > 0 ? [80, 60, 80, 60, 80] : 40);
      }
      renderHealth(true);
      nextFood();
      busy = false;
    }, 1150);
  }

  function reject() {
    play("no");
    gesture("no");
    say(pick(["¡No!", "¡Guácala!", "Eso no", "¿Verdura? No"]));
  }

  // ---------- Arrastrar comida ----------
  const food = $("food");
  let drag = null;

  function faceRect() { return $("face-wrap").getBoundingClientRect(); }
  function overFace(x, y) {
    const r = faceRect();
    // Zona de la boca: centro‑abajo de la cara
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.62;
    const rx = r.width * 0.36, ry = r.height * 0.36;
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }

  food.addEventListener("pointerdown", (e) => {
    if (busy || !current) return;
    e.preventDefault();
    const r = food.getBoundingClientRect();
    drag = { id: e.pointerId, home: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
    food.setPointerCapture(e.pointerId);
    food.classList.remove("enter", "returning");
    food.classList.add("dragging");
    move(e.clientX, e.clientY);
  });

  function move(x, y) {
    const w = food.offsetWidth;
    food.style.transform = `translate(${x - w / 2}px, ${y - w / 2}px) rotate(${Math.sin(x / 40) * 8}deg)`;
    // Al acercar la comida: se antoja de lo fat y duda de lo fit si está gordo
    const near = overFace(x, y);
    const doubt = near && current.kind === "fit" && level > 0;
    $("face-wrap").classList.toggle("eager", near && !doubt);
    $("face-wrap").classList.toggle("doubt", doubt);
  }

  food.addEventListener("pointermove", (e) => { if (drag && e.pointerId === drag.id) move(e.clientX, e.clientY); });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { home } = drag;
    drag = null;
    $("face-wrap").classList.remove("eager", "doubt");
    const w = food.offsetWidth;

    if (overFace(e.clientX, e.clientY)) {
      busy = true;
      const r = faceRect();
      const mx = r.left + r.width / 2, my = r.top + r.height * 0.7;
      if (Math.random() < rejectChance(current)) {
        reject();
        // La comida sale disparada de regreso al plato
        food.classList.add("returning");
        food.style.transform = `translate(${home.x - w / 2}px, ${home.y - w / 2}px) rotate(-25deg)`;
        setTimeout(() => {
          food.classList.remove("dragging", "returning");
          food.style.transform = "";
          busy = false;
        }, 480);
      } else {
        food.classList.add("eaten");
        food.style.transform = `translate(${mx - w / 2}px, ${my - w / 2}px) scale(.15) rotate(40deg)`;
        crumbs(mx, my, current.kind);
        setTimeout(() => {
          food.style.opacity = "0"; // queda oculta hasta que llegue la siguiente comida
          food.classList.remove("dragging", "eaten");
          food.style.transform = "";
        }, 460);
        eat(current);
      }
    } else {
      food.classList.add("returning");
      food.style.transform = `translate(${home.x - w / 2}px, ${home.y - w / 2}px)`;
      setTimeout(() => {
        food.classList.remove("dragging", "returning");
        food.style.transform = "";
      }, 460);
    }
  }
  food.addEventListener("pointerup", endDrag);
  food.addEventListener("pointercancel", endDrag);

  // ---------- Botones ----------
  $("swap").addEventListener("click", () => { if (!busy) nextFood(); });

  function renderMute() {
    $("mute").textContent = muted ? "Sonido: no" : "Sonido: sí";
    $("mute").setAttribute("aria-pressed", String(muted));
  }
  $("mute").addEventListener("click", () => {
    muted = !muted;
    if (muted) stopSounds();
    try { localStorage.setItem("ari-muted", muted ? "1" : "0"); } catch {}
    renderMute();
  });

  $("play").addEventListener("click", () => {
    unlockAudio(); // primer toque: crea el audio y descarga los sonidos
    level = 0;
    newCounters();
    $("cover").hidden = true;
    $("game").hidden = false;
    renderHealth(false);
    renderMute();
    nextFood();
  });
})();
