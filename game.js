(() => {
  "use strict";

  const canvas = document.querySelector("#game-canvas");
  const ctx = canvas.getContext("2d");
  const ui = {
    health: document.querySelector("#health-fill"),
    healthReadout: document.querySelector("#health-readout"),
    timer: document.querySelector("#timer"),
    score: document.querySelector("#score"),
    streak: document.querySelector("#streak"),
    tacticChip: document.querySelector("#tactic-chip"),
    tacticLabel: document.querySelector("#tactic-label"),
    abilityStatus: document.querySelector("#ability-status"),
    toast: document.querySelector("#adaptation-toast"),
    toastMessage: document.querySelector("#toast-message"),
    start: document.querySelector("#start-overlay"),
    pause: document.querySelector("#pause-overlay"),
    upgrade: document.querySelector("#upgrade-overlay"),
    gameover: document.querySelector("#gameover-overlay"),
    best: document.querySelector("#best-score"),
    status: document.querySelector("#status-text"),
    joystick: document.querySelector("#joystick"),
    joystickKnob: document.querySelector("#joystick-knob")
  };
  const W = 1000;
  const H = 625;
  const ARENA = { left: 34, right: 966, top: 24, bottom: 591 };
  const TAU = Math.PI * 2;
  const TACTICS = ["hunter", "interceptor", "flanker"];
  const TACTIC_NAMES = { hunter: "HUNTER", interceptor: "INTERCEPTOR", flanker: "FLANKER" };
  const KEY_CODES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
  let width = W;
  let height = H;
  let state = "title";
  let previousTime = 0;
  let accumulator = 0;
  let elapsed = 0;
  let score = 0;
  let health = 100;
  let crystalsCollected = 0;
  let streak = 0;
  let streakTimer = 0;
  let spawnTimer = 0;
  let crystalTimer = 0;
  let difficulty = 0;
  let shake = 0;
  let particles = [];
  let enemies = [];
  let crystals = [];
  let shots = [];
  let history = [];
  let activeTactic = "hunter";
  let tacticLock = 0;
  let toastTimer = 0;
  let milestone = 500;
  let lastDamageTime = -10;
  let roundTactics = new Set();
  let audioContext = null;
  let muted = false;
  let joystickPointer = null;
  let joystickVector = { x: 0, y: 0 };
  let lastMove = { x: 1, y: 0 };
  let lastSample = 0;
  let scoreRemainder = 0;
  let gameTime = 0;
  const keys = new Set();
  const abilities = { speed: 0, shield: 0, pulse: 0 };
  let acquiredAbilities = [];
  const player = { x: W / 2, y: H / 2, radius: 12, speed: 215, invuln: 0, boost: 0, shield: 0 };

  const safeStorage = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        ui.status.textContent = "PERSONAL BEST COULD NOT BE SAVED";
      }
    }
  };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    width = rect.width;
    height = rect.height;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }

  function random(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function formatTime(seconds) {
    const value = Math.floor(seconds);
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }
  function formattedScore(value) { return String(Math.floor(value)).padStart(6, "0"); }
  function playerInput() {
    let x = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0) + joystickVector.x;
    let y = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) + joystickVector.y;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    if (length > 0.08) lastMove = { x: x / length, y: y / length };
    return { x, y, moving: length > 0.08 };
  }

  function startRun() {
    state = "playing";
    accumulator = 0;
    keys.clear();
    joystickVector = { x: 0, y: 0 };
    elapsed = 0; gameTime = 0; score = 0; health = 100;
    crystalsCollected = 0; streak = 0; streakTimer = 0; spawnTimer = 1.5;
    crystalTimer = 0.8; difficulty = 0; shake = 0; particles = [];
    enemies = []; crystals = []; shots = []; history = []; activeTactic = "hunter";
    tacticLock = 0; milestone = 500; lastDamageTime = -10; roundTactics = new Set();
    lastSample = 0; scoreRemainder = 0;
    player.x = W / 2; player.y = H / 2; player.invuln = 2.5; player.boost = 0; player.shield = 0;
    Object.keys(abilities).forEach(key => { abilities[key] = 0; });
    acquiredAbilities = [];
    ui.toast.classList.remove("show");
    ui.tacticChip.style.borderColor = "";
    ui.tacticLabel.textContent = "HUNTER · SCANNING";
    document.querySelector("#pause-button").hidden = false;
    hideOverlays();
    syncHUD();
    updateTacticPanel();
    ui.status.textContent = "THREAT ANALYSIS ACTIVE";
    createEnemy("hunter", 0);
    createEnemy("hunter", 1);
  }

  function hideOverlays() {
    [ui.start, ui.pause, ui.upgrade, ui.gameover].forEach(element => element.classList.add("hidden"));
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      accumulator = 0;
      ui.pause.classList.remove("hidden");
      ui.status.textContent = "SIMULATION PAUSED";
      document.querySelector("#pause-button").hidden = true;
    } else if (state === "paused") {
      state = "playing";
      ui.pause.classList.add("hidden");
      ui.status.textContent = "THREAT ANALYSIS ACTIVE";
      document.querySelector("#pause-button").hidden = false;
      previousTime = performance.now();
    }
  }

  function activateUpgrade(name) {
    const settings = {
      speed: { duration: 4.5, cooldown: 12, text: "SPEED BURST ACTIVE" },
      shield: { duration: 2.8, cooldown: 14, text: "ENERGY SHIELD ACTIVE" },
      pulse: { duration: 0.25, cooldown: 10, text: "ENERGY PULSE RELEASED" }
    };
    const upgrade = settings[name];
    if (!upgrade || abilities[name] > 0 || state !== "playing") return false;
    abilities[name] = upgrade.cooldown;
    if (name === "speed") player.boost = upgrade.duration;
    if (name === "shield") player.shield = upgrade.duration;
    if (name === "pulse") pulseEnemies();
    ui.status.textContent = upgrade.text;
    spawnBurst(player.x, player.y, name === "pulse" ? "#ffac69" : name === "shield" ? "#79eac0" : "#55d9ff", name === "pulse" ? 32 : 14);
    sound(name === "pulse" ? "pulse" : "upgrade");
    return true;
  }

  function useAbility() {
    for (const name of acquiredAbilities.slice().reverse()) {
      if (abilities[name] === 0 && activateUpgrade(name)) return;
    }
  }

  function grantUpgrade(name) {
    state = "playing";
    accumulator = 0;
    ui.upgrade.classList.add("hidden");
    document.querySelector("#pause-button").hidden = false;
    if (!acquiredAbilities.includes(name)) acquiredAbilities.push(name);
    activateUpgrade(name);
    ui.status.textContent = `${name.toUpperCase()} UPGRADE ACQUIRED`;
    previousTime = performance.now();
  }

  function offerUpgrade() {
    state = "upgrade";
    accumulator = 0;
    document.querySelector("#pause-button").hidden = true;
    ui.upgrade.classList.remove("hidden");
    sound("upgrade");
  }

  function createEnemy(type = "hunter", attempt = 0) {
    let x;
    let y;
    for (let i = 0; i < 16; i++) {
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { x = random(ARENA.left + 24, ARENA.right - 24); y = ARENA.top + 22; }
      else if (edge === 1) { x = random(ARENA.left + 24, ARENA.right - 24); y = ARENA.bottom - 22; }
      else if (edge === 2) { x = ARENA.left + 22; y = random(ARENA.top + 24, ARENA.bottom - 24); }
      else { x = ARENA.right - 22; y = random(ARENA.top + 24, ARENA.bottom - 24); }
      if (distance({ x, y }, player) > 190) break;
    }
    const roles = ["hunter", "interceptor", "flanker"];
    const role = type || roles[attempt % roles.length];
    enemies.push({
      x, y, radius: role === "interceptor" ? 12 : 11, role,
      speed: (role === "hunter" ? 64 : 56) + Math.min(45, difficulty * 2.7) + random(-4, 6),
      phase: random(0, TAU), attack: random(2, 4), stun: 0,
      orbit: Math.random() < .5 ? -1 : 1, wobble: random(0, TAU)
    });
  }

  function spawnCrystal() {
    let crystal;
    for (let i = 0; i < 30; i++) {
      crystal = { x: random(ARENA.left + 38, ARENA.right - 38), y: random(ARENA.top + 38, ARENA.bottom - 38) };
      if (distance(crystal, player) > 100 && enemies.every(enemy => distance(crystal, enemy) > 65)) break;
    }
    crystals.push({ ...crystal, phase: random(0, TAU), life: 13 });
  }

  function pulseEnemies() {
    for (const enemy of enemies) {
      const d = distance(player, enemy);
      if (d < 225) {
        const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
        const force = (1 - d / 225);
        enemy.x = clamp(enemy.x + Math.cos(angle) * (90 + 90 * force), ARENA.left + 15, ARENA.right - 15);
        enemy.y = clamp(enemy.y + Math.sin(angle) * (90 + 90 * force), ARENA.top + 15, ARENA.bottom - 15);
        enemy.stun = .95;
        spawnBurst(enemy.x, enemy.y, "#ffb273", 7);
      }
    }
    for (const shot of shots) {
      if (distance(player, shot) < 245) shot.dead = true;
    }
    shots = shots.filter(shot => !shot.dead);
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (distance(player, enemies[i]) < 92) {
        score += 25;
        spawnBurst(enemies[i].x, enemies[i].y, "#ff8f64", 10);
        enemies.splice(i, 1);
      }
    }
  }

  function addScore(amount) {
    score += amount;
    while (score >= milestone) {
      milestone += 500;
      offerUpgrade();
      break;
    }
  }

  function sampleMovement(now) {
    if (now - lastSample < .24) return;
    lastSample = now;
    const threatDistance = enemies.reduce((nearest, enemy) => Math.min(nearest, distance(player, enemy)), Infinity);
    history.push({ x: player.x, y: player.y, t: now, threatDistance });
    while (history.length && now - history[0].t > 8) history.shift();
    if (history.length >= 6 && elapsed > 5) classifyPattern();
  }

  function classifyPattern() {
    const first = history[0];
    const last = history[history.length - 1];
    const duration = last.t - first.t;
    if (duration < 3) return;
    const meanX = history.reduce((sum, point) => sum + point.x, 0) / history.length;
    const meanY = history.reduce((sum, point) => sum + point.y, 0) / history.length;
    const radius = history.reduce((sum, point) => sum + Math.hypot(point.x - meanX, point.y - meanY), 0) / history.length;
    const pathLength = history.slice(1).reduce((sum, point, i) => sum + distance(point, history[i]), 0);
    const pathEfficiency = pathLength / Math.max(1, distance(first, last));
    let angleSum = 0;
    let validAngles = 0;
    for (let i = 1; i < history.length - 1; i++) {
      const a = Math.atan2(history[i].y - meanY, history[i].x - meanX);
      const b = Math.atan2(history[i + 1].y - meanY, history[i + 1].x - meanX);
      let delta = b - a;
      if (delta > Math.PI) delta -= TAU;
      if (delta < -Math.PI) delta += TAU;
      angleSum += delta;
      validAngles++;
    }
    const circles = Math.abs(angleSum) / TAU;
    const movingDistance = history.reduce((sum, point, i) => i ? sum + distance(point, history[i - 1]) : sum, 0);
    let escapeVotes = 0;
    let escapeChecks = 0;
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1].threatDistance;
      const after = history[i].threatDistance;
      if (Number.isFinite(before) && Number.isFinite(after) && distance(history[i], history[i - 1]) > 4) {
        escapeChecks++;
        if (after > before + 2) escapeVotes++;
      }
    }
    const escapeRatio = escapeChecks ? escapeVotes / escapeChecks : 0;
    const scores = {
      flanker: radius < 74 && duration > 5 ? clamp((74 - radius) / 55 + duration / 22, 0, 1) : 0,
      interceptor: circles > .6 && validAngles > 4 && pathEfficiency > 1.65 ? clamp(circles / 1.4 + (pathEfficiency - 1.5) / 3, 0, 1) : 0,
      hunter: escapeRatio > .66 && movingDistance > 140 ? clamp(escapeRatio * .72 + Math.min(movingDistance / 1500, .28), 0, 1) : 0
    };
    const candidate = TACTICS.reduce((best, tactic) => scores[tactic] > scores[best] ? tactic : best, "hunter");
    const scoreValue = scores[candidate];
    const requiredConfidence = candidate === "flanker" ? .64 : .57;
    if (scoreValue >= requiredConfidence && candidate !== activeTactic && tacticLock <= 0) {
      changeTactic(candidate, scoreValue);
    }
  }

  function changeTactic(tactic, confidence) {
    activeTactic = tactic;
    tacticLock = 10;
    roundTactics.add(tactic);
    updateTacticPanel();
    ui.tacticLabel.textContent = `${TACTIC_NAMES[tactic]} · ADAPTED`;
    ui.tacticChip.style.borderColor = tactic === "hunter" ? "rgba(255,82,107,.5)" : tactic === "flanker" ? "rgba(219,128,255,.5)" : "rgba(255,176,95,.5)";
    ui.toastMessage.textContent = `${TACTIC_NAMES[tactic]} DEPLOYED`;
    ui.toast.classList.add("show");
    toastTimer = 3;
    ui.status.textContent = `${TACTIC_NAMES[tactic]} TACTIC ACTIVE`;
    const count = tactic === "flanker" ? 2 : confidence > .78 ? 3 : 2;
    for (let i = 0; i < count; i++) createEnemy(tactic, i);
    sound("adapt");
  }

  function updateTacticPanel() {
    for (const tactic of TACTICS) {
      const row = document.querySelector(`[data-tactic="${tactic}"]`);
      const stateLabel = document.querySelector(`#state-${tactic}`);
      row.classList.toggle("active", activeTactic === tactic);
      stateLabel.textContent = activeTactic === tactic ? "DEPLOYED" : roundTactics.has(tactic) ? "LEARNED" : "DORMANT";
    }
    if (!roundTactics.size) {
      document.querySelector("#state-hunter").textContent = "BASELINE";
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      enemy.phase += dt * 2;
      enemy.attack -= dt;
      if (enemy.stun > 0) { enemy.stun = Math.max(0, enemy.stun - dt); continue; }
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      let tx = player.x;
      let ty = player.y;
      let speed = enemy.speed;
      const tactic = activeTactic === "hunter" ? enemy.role : activeTactic;
      if (tactic === "interceptor") {
        const lead = clamp(d / 155, .35, 1.25);
        tx += lastMove.x * player.speed * lead;
        ty += lastMove.y * player.speed * lead;
        const strafe = Math.sin(gameTime * 2.5 + enemy.wobble) * 15;
        tx += (-dy / d) * strafe;
        ty += (dx / d) * strafe;
        speed *= .95;
      } else if (tactic === "flanker") {
        const angle = Math.atan2(dy, dx) + enemy.orbit * .9;
        const flankDistance = clamp(d * .72, 125, 185);
        tx = player.x + Math.cos(angle) * flankDistance;
        ty = player.y + Math.sin(angle) * flankDistance;
        if (d < 150) { tx = player.x + Math.cos(angle) * 190; ty = player.y + Math.sin(angle) * 190; }
        speed *= .88;
      }
      const angle = Math.atan2(ty - enemy.y, tx - enemy.x);
      const weave = Math.sin(gameTime * 1.8 + enemy.wobble) * (tactic === "hunter" ? 9 : 5);
      enemy.x += (Math.cos(angle) * speed - Math.sin(angle) * weave) * dt;
      enemy.y += (Math.sin(angle) * speed + Math.cos(angle) * weave) * dt;
      enemy.x = clamp(enemy.x, ARENA.left + enemy.radius, ARENA.right - enemy.radius);
      enemy.y = clamp(enemy.y, ARENA.top + enemy.radius, ARENA.bottom - enemy.radius);
      if (activeTactic === "interceptor" && enemy.attack <= 0 && d > 160 && d < 410) {
        fireShot(enemy, tx, ty);
        enemy.attack = random(3.2, 4.6);
      }
      if (d < player.radius + enemy.radius + 2 && player.invuln <= 0 && player.shield <= 0) {
        takeDamage(12);
        const knock = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        player.x = clamp(player.x + Math.cos(knock) * 27, ARENA.left + player.radius, ARENA.right - player.radius);
        player.y = clamp(player.y + Math.sin(knock) * 27, ARENA.top + player.radius, ARENA.bottom - player.radius);
      }
    }
  }

  function fireShot(enemy, targetX, targetY) {
    const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
    shots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 180, vy: Math.sin(angle) * 180, radius: 5, life: 3.2 });
  }

  function updateShots(dt) {
    for (const shot of shots) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (shot.life <= 0 || shot.x < ARENA.left || shot.x > ARENA.right || shot.y < ARENA.top || shot.y > ARENA.bottom) shot.dead = true;
      if (distance(player, shot) < player.radius + shot.radius && player.invuln <= 0 && player.shield <= 0) {
        shot.dead = true;
        takeDamage(10);
      }
    }
    shots = shots.filter(shot => !shot.dead);
  }

  function takeDamage(amount) {
    if (state !== "playing" || player.shield > 0 || player.invuln > 0) return;
    health = Math.max(0, health - amount);
    player.invuln = 1.05;
    shake = 7;
    lastDamageTime = elapsed;
    spawnBurst(player.x, player.y, "#ff546b", 15);
    sound("damage");
    syncHUD();
    if (health <= 0) endRun();
  }

  function collectCrystals() {
    for (let i = crystals.length - 1; i >= 0; i--) {
      const crystal = crystals[i];
      if (distance(player, crystal) < player.radius + 12) {
        crystals.splice(i, 1);
        crystalsCollected++;
        streak = streakTimer > 0 ? streak + 1 : 1;
        streakTimer = 6;
        addScore(100 * Math.min(3, 1 + Math.floor((streak - 1) / 3)));
        spawnBurst(crystal.x, crystal.y, "#a5f8ff", 12);
        sound("crystal");
        syncHUD();
      }
    }
  }

  function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = random(0, TAU);
      const speed = random(22, 115);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: random(.25, .75), maxLife: .75, size: random(1, 3), color });
    }
  }

  function update(dt) {
    if (state !== "playing") return;
    gameTime += dt;
    elapsed += dt;
    difficulty = elapsed / 12;
    tacticLock = Math.max(0, tacticLock - dt);
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove("show");
    player.invuln = Math.max(0, player.invuln - dt);
    player.boost = Math.max(0, player.boost - dt);
    player.shield = Math.max(0, player.shield - dt);
    shake = Math.max(0, shake - dt * 22);
    streakTimer = Math.max(0, streakTimer - dt);
    if (!streakTimer) streak = 0;
    Object.keys(abilities).forEach(key => { abilities[key] = Math.max(0, abilities[key] - dt); });

    const input = playerInput();
    const movement = player.speed * (player.boost > 0 ? 1.72 : 1);
    player.x = clamp(player.x + input.x * movement * dt, ARENA.left + player.radius, ARENA.right - player.radius);
    player.y = clamp(player.y + input.y * movement * dt, ARENA.top + player.radius, ARENA.bottom - player.radius);
    sampleMovement(elapsed);

    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < Math.min(10, 2 + Math.floor(elapsed / 15))) {
      createEnemy(activeTactic);
      spawnTimer = Math.max(1.7, 5.5 - elapsed * .035);
    }
    crystalTimer -= dt;
    if (crystalTimer <= 0 && crystals.length < 4) {
      spawnCrystal();
      crystalTimer = random(3.1, 5);
    }
    for (const crystal of crystals) { crystal.phase += dt * 2; crystal.life -= dt; }
    crystals = crystals.filter(crystal => crystal.life > 0);
    updateEnemies(dt);
    if (state !== "playing") return;
    updateShots(dt);
    if (state !== "playing") return;
    collectCrystals();
    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 2.7);
      particle.vy *= Math.max(0, 1 - dt * 2.7);
      particle.life -= dt;
    }
    particles = particles.filter(particle => particle.life > 0);
    scoreRemainder += dt;
    if (scoreRemainder >= 1) {
      const points = Math.floor(scoreRemainder);
      scoreRemainder -= points;
      addScore(points * 5);
    }
    syncHUD();
    if (elapsed >= 90) endRun();
  }

  function syncHUD() {
    ui.health.style.width = `${health}%`;
    ui.health.classList.toggle("low", health <= 35);
    ui.healthReadout.textContent = `${Math.ceil(health)}%`;
    ui.timer.textContent = formatTime(elapsed);
    ui.score.textContent = formattedScore(score);
    ui.streak.textContent = streak;
    const readyAbility = acquiredAbilities.slice().reverse().find(name => abilities[name] <= 0);
    const activeAbility = player.boost > 0 ? "SPEED ACTIVE" : player.shield > 0 ? "SHIELD ACTIVE" : null;
    ui.abilityStatus.textContent = activeAbility ? `ABILITY · ${activeAbility}` : readyAbility ? `ABILITY · ${readyAbility.toUpperCase()} READY` : acquiredAbilities.length ? "ABILITY · RECHARGING" : "ABILITY · NONE";
    ui.abilityStatus.classList.toggle("ready", Boolean(readyAbility || activeAbility));
    const best = Number(safeStorage.get("evolve-arena-best", "0")) || 0;
    ui.best.textContent = formattedScore(best);
    if (activeTactic === "hunter" && !roundTactics.size) ui.tacticLabel.textContent = "HUNTER · SCANNING";
  }

  function endRun() {
    if (state === "gameover") return;
    state = "gameover";
    accumulator = 0;
    document.querySelector("#pause-button").hidden = true;
    const oldBest = Number(safeStorage.get("evolve-arena-best", "0")) || 0;
    const best = Math.max(oldBest, Math.floor(score));
    if (best !== oldBest) safeStorage.set("evolve-arena-best", best);
    document.querySelector("#final-score").textContent = Math.floor(score).toLocaleString();
    document.querySelector("#final-time").textContent = formatTime(elapsed);
    document.querySelector("#final-crystals").textContent = crystalsCollected;
    document.querySelector("#final-best").textContent = best.toLocaleString();
    document.querySelector("#result-title").innerHTML = health <= 0 ? "THE ARENA<br><em>REMEMBERS.</em>" : "YOU OUTLASTED<br><em>THE ARENA.</em>";
    const summary = document.querySelector("#tactics-summary");
    summary.replaceChildren();
    const active = TACTICS.filter(tactic => roundTactics.has(tactic));
    if (!active.length) {
      const note = document.createElement("span");
      note.className = "summary-empty";
      note.textContent = "No adaptation triggered — keep moving to reveal the arena's tactics.";
      summary.append(note);
    } else {
      for (const tactic of active) {
        const tag = document.createElement("span");
        tag.className = "summary-tag";
        tag.textContent = `${TACTIC_NAMES[tactic]} ${tactic === "flanker" ? "· CAMPING" : tactic === "interceptor" ? "· CIRCULAR MOVEMENT" : "· CONSTANT ESCAPING"}`;
        summary.append(tag);
      }
    }
    ui.status.textContent = "RUN COMPLETE";
    ui.gameover.classList.remove("hidden");
  }

  function drawBackground() {
    ctx.fillStyle = "#08101c";
    ctx.fillRect(0, 0, W, H);
    const gradient = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 540);
    gradient.addColorStop(0, "rgba(19, 51, 77, .28)");
    gradient.addColorStop(.65, "rgba(11, 26, 43, .15)");
    gradient.addColorStop(1, "rgba(4, 9, 17, .58)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.left, ARENA.top, ARENA.right - ARENA.left, ARENA.bottom - ARENA.top);
    ctx.clip();
    ctx.strokeStyle = "rgba(111, 159, 192, .075)";
    ctx.lineWidth = 1;
    for (let x = ARENA.left; x <= ARENA.right; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, ARENA.top); ctx.lineTo(x, ARENA.bottom); ctx.stroke();
    }
    for (let y = ARENA.top; y <= ARENA.bottom; y += 40) {
      ctx.beginPath(); ctx.moveTo(ARENA.left, y); ctx.lineTo(ARENA.right, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(88, 151, 191, .07)";
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 146, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 285, 0, TAU); ctx.stroke();
    for (let i = 0; i < 55; i++) {
      const x = (i * 197 + 73) % W;
      const y = (i * 103 + 47) % H;
      const alpha = .09 + Math.sin(gameTime * .7 + i) * .045;
      ctx.fillStyle = `rgba(125, 210, 240, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(84, 163, 205, .26)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ARENA.left + .5, ARENA.top + .5, ARENA.right - ARENA.left - 1, ARENA.bottom - ARENA.top - 1);
    drawCorner(ARENA.left, ARENA.top, 1, 1);
    drawCorner(ARENA.right, ARENA.top, -1, 1);
    drawCorner(ARENA.left, ARENA.bottom, 1, -1);
    drawCorner(ARENA.right, ARENA.bottom, -1, -1);
  }

  function drawCorner(x, y, sx, sy) {
    ctx.strokeStyle = "rgba(72, 199, 240, .7)";
    ctx.beginPath();
    ctx.moveTo(x, y + 13 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 13 * sx, y);
    ctx.stroke();
  }

  function drawCrystal(crystal) {
    const pulse = Math.sin(crystal.phase) * 2;
    ctx.save();
    ctx.translate(crystal.x, crystal.y);
    ctx.rotate(Math.PI / 4);
    ctx.shadowBlur = 19;
    ctx.shadowColor = "#8aeeff";
    ctx.fillStyle = "rgba(107, 232, 255, .18)";
    ctx.strokeStyle = "#b4f8ff";
    ctx.lineWidth = 1.5;
    ctx.fillRect(-7 - pulse * .2, -7 - pulse * .2, 14 + pulse * .4, 14 + pulse * .4);
    ctx.strokeRect(-7 - pulse * .2, -7 - pulse * .2, 14 + pulse * .4, 14 + pulse * .4);
    ctx.fillStyle = "#e1ffff";
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }

  function drawEnemy(enemy) {
    const role = activeTactic === "hunter" ? enemy.role : activeTactic;
    const color = role === "interceptor" ? "#ffb05f" : role === "flanker" ? "#dc83ff" : "#ff586c";
    const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(angle);
    ctx.shadowBlur = 13;
    ctx.shadowColor = color;
    ctx.fillStyle = "rgba(255, 80, 104, .14)";
    ctx.strokeStyle = enemy.stun > 0 ? "#fff1b4" : color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(enemy.radius + 3, 0);
    ctx.lineTo(-enemy.radius * .72, enemy.radius * .78);
    ctx.lineTo(-enemy.radius * .35, 0);
    ctx.lineTo(-enemy.radius * .72, -enemy.radius * .78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(1, 0, 2.1, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (role === "interceptor" && activeTactic === "interceptor" && enemy.attack < 1.1) {
      ctx.strokeStyle = `rgba(255,176,95,${.18 + Math.sin(gameTime * 9) * .1})`;
      ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 21 + Math.sin(gameTime * 8) * 2, 0, TAU); ctx.stroke();
    }
  }

  function drawPlayer() {
    const blink = player.invuln > 0 && Math.floor(gameTime * 17) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(Math.atan2(lastMove.y, lastMove.x));
    if (player.shield > 0) {
      const fade = .45 + Math.sin(gameTime * 11) * .13;
      ctx.strokeStyle = `rgba(113,255,202,${fade})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16;
      ctx.shadowColor = "#70f4c3";
      ctx.beginPath(); ctx.arc(0, 0, 22 + Math.sin(gameTime * 9) * 1.5, 0, TAU); ctx.stroke();
    }
    if (player.boost > 0) {
      ctx.fillStyle = "rgba(77,213,255,.55)";
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-25 - Math.random() * 8, 6); ctx.lineTo(-25 - Math.random() * 8, -6); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#42cfff";
    ctx.fillStyle = "rgba(70,206,255,.22)";
    ctx.strokeStyle = "#70e5ff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(-8, 9); ctx.lineTo(-5, 0); ctx.lineTo(-8, -9); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e4fcff";
    ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(1, 0, 2.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate(random(-shake, shake), random(-shake, shake));
    drawBackground();
    for (const crystal of crystals) drawCrystal(crystal);
    for (const shot of shots) {
      ctx.fillStyle = "#ffbc75";
      ctx.shadowBlur = 14; ctx.shadowColor = "#ff9153";
      ctx.beginPath(); ctx.arc(shot.x, shot.y, shot.radius, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const enemy of enemies) drawEnemy(enemy);
    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 7; ctx.shadowColor = particle.color;
      ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    drawPlayer();
    ctx.restore();
  }

  function sound(type) {
    if (muted) return;
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {
          muted = true;
          ui.status.textContent = "AUDIO UNAVAILABLE — GAMEPLAY UNAFFECTED";
        });
      }
      const now = audioContext.currentTime;
      const settings = {
        crystal: [880, 0.1, "sine", .065],
        damage: [145, 0.2, "sawtooth", .055],
        upgrade: [440, 0.22, "triangle", .05],
        adapt: [260, 0.29, "sawtooth", .04],
        pulse: [110, 0.32, "sine", .08]
      }[type];
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = settings[2];
      oscillator.frequency.setValueAtTime(settings[0], now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, settings[0] * (type === "damage" ? .55 : 1.5)), now + settings[1]);
      gain.gain.setValueAtTime(settings[3], now);
      gain.gain.exponentialRampToValueAtTime(.001, now + settings[1]);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now); oscillator.stop(now + settings[1]);
    } catch {
      muted = true;
      ui.status.textContent = "AUDIO UNAVAILABLE — GAMEPLAY UNAFFECTED";
    }
  }

  document.querySelector("#start-button").addEventListener("click", startRun);
  document.querySelector("#again-button").addEventListener("click", startRun);
  document.querySelector("#resume-button").addEventListener("click", togglePause);
  document.querySelector("#pause-button").addEventListener("click", togglePause);
  document.querySelectorAll("[data-upgrade]").forEach(button => {
    button.addEventListener("click", () => grantUpgrade(button.dataset.upgrade));
  });
  document.querySelector("#ability-button").addEventListener("pointerdown", event => {
    event.preventDefault();
    if (state === "playing") useAbility();
  });
  document.querySelector("#sound-button").addEventListener("click", () => {
    muted = !muted;
    document.querySelector("#sound-button").setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");
    document.querySelector("#sound-icon").innerHTML = muted
      ? '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>';
    if (!muted) sound("crystal");
  });
  window.addEventListener("keydown", event => {
    if (KEY_CODES.has(event.code)) event.preventDefault();
    if (event.repeat && (event.code === "Space" || event.code === "Escape" || event.code === "KeyP")) return;
    if (event.code === "Escape" || event.code === "KeyP") {
      if (state === "playing" || state === "paused") togglePause();
      return;
    }
    if (event.code === "Space") {
      if (state === "playing") useAbility();
      else if (state === "title") startRun();
    }
    keys.add(event.code);
  });
  window.addEventListener("keyup", event => keys.delete(event.code));
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      keys.clear();
      if (state === "playing") togglePause();
    }
  });
  ui.joystick.addEventListener("pointerdown", event => {
    joystickPointer = event.pointerId;
    ui.joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  ui.joystick.addEventListener("pointermove", event => {
    if (event.pointerId === joystickPointer) updateJoystick(event);
  });
  function releaseJoystick(event) {
    if (event.pointerId !== joystickPointer) return;
    joystickPointer = null;
    joystickVector = { x: 0, y: 0 };
    ui.joystickKnob.style.transform = "translate(0, 0)";
  }
  ui.joystick.addEventListener("pointerup", releaseJoystick);
  ui.joystick.addEventListener("pointercancel", releaseJoystick);
  function updateJoystick(event) {
    const rect = ui.joystick.getBoundingClientRect();
    const radius = rect.width * .34;
    let x = event.clientX - (rect.left + rect.width / 2);
    let y = event.clientY - (rect.top + rect.height / 2);
    const d = Math.hypot(x, y);
    if (d > radius) { x *= radius / d; y *= radius / d; }
    joystickVector = { x: x / radius, y: y / radius };
    ui.joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
  }

  function frame(timestamp) {
    const frameDelta = previousTime ? Math.max(0, (timestamp - previousTime) / 1000) : 0;
    previousTime = timestamp;
    if (state === "playing") {
      accumulator += Math.min(frameDelta, .25);
      while (accumulator >= 1 / 60 && state === "playing") {
        update(1 / 60);
        accumulator -= 1 / 60;
      }
      if (state !== "playing") accumulator = 0;
    } else if (state === "title" || state === "gameover" || state === "upgrade" || state === "paused") {
      accumulator = 0;
      gameTime += Math.min(frameDelta, .25);
      if (state === "title") {
        for (const particle of particles) particle.life -= Math.min(frameDelta, .25);
        particles = particles.filter(particle => particle.life > 0);
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function titleAmbience() {
    if (state !== "title" || Math.random() > .18) return;
    const edge = Math.floor(Math.random() * 4);
    const x = edge < 2 ? random(ARENA.left, ARENA.right) : edge === 2 ? ARENA.left : ARENA.right;
    const y = edge < 2 ? (edge === 0 ? ARENA.top : ARENA.bottom) : random(ARENA.top, ARENA.bottom);
    spawnBurst(x, y, "#3d839e", 1);
  }

  resizeCanvas();
  syncHUD();
  window.addEventListener("resize", resizeCanvas);
  setInterval(titleAmbience, 900);
  requestAnimationFrame(frame);
})();
