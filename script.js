const arena = document.getElementById("arena");
const overlay = document.getElementById("overlay");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const playAgainBtn = document.getElementById("playAgainBtn");
const leaderboard = document.getElementById("leaderboard");
const stepConnect = document.getElementById("stepConnect");
const stepGame = document.getElementById("stepGame");
const hostTotalWrap = document.getElementById("hostTotalWrap");
const hostBombWrap = document.getElementById("hostBombWrap");
const guestLoadingText = document.getElementById("guestLoadingText");

const totalButtonsInput = document.getElementById("totalButtonsInput");
const bombCountInput = document.getElementById("bombCountInput");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");

const scoreText = document.getElementById("scoreText");
const treasureText = document.getElementById("treasureText");
const heartText = document.getElementById("heartText");
const fishText = document.getElementById("fishText");
const poopText = document.getElementById("poopText");
const crabText = document.getElementById("crabText");
const crownText = document.getElementById("crownText");
const bombText = document.getElementById("bombText");
const stateText = document.getElementById("stateText");
const messageText = document.getElementById("messageText");
const randomCountsText = document.getElementById("randomCountsText");

const playerNameInput = document.getElementById("playerNameInput");
const mpConnectBtn = document.getElementById("mpConnectBtn");
const mpStatusText = document.getElementById("mpStatusText");

const WS_SERVER_URL = "wss://treasure-game-github-io.onrender.com";
const FIXED_ROOM_ID = "main";
const TREASURE_SFX_URL = "sound/treasure.mp3";

let treasureSfxAudio = null;
function playTreasureSound() {
  if (!treasureSfxAudio) treasureSfxAudio = new Audio(TREASURE_SFX_URL);
  treasureSfxAudio.currentTime = 0;
  void treasureSfxAudio.play().catch(() => {});
}

const BOOM_SFX_URL = "sound/boom.mp3";
let boomSfxAudio = null;
function playBoomSound() {
  if (!boomSfxAudio) boomSfxAudio = new Audio(BOOM_SFX_URL);
  boomSfxAudio.currentTime = 0;
  void boomSfxAudio.play().catch(() => {});
}

const BACKGROUND_THEMES = ["bg-ocean", "bg-space", "bg-landscape"];
const ROLE_EXTRA_SCORE = { treasure: 10, heart: 50, fish: 7, poop: -15, crab: 5, crown: 30 };

let gameActive = false;
let cells = [];
let bombSet = new Set();
let roleSets = {
  treasure: new Set(),
  heart: new Set(),
  fish: new Set(),
  poop: new Set(),
  crab: new Set(),
  crown: new Set()
};
let currentRandomCounts = { bomb: 0, treasure: 0, heart: 0, fish: 0, poop: 0, crab: 0, crown: 0 };
let hostArenaWidth = 1;
let hostArenaHeight = 1;
let applyingRemoteState = false;

let mpSocket = null;
let mpClientId = "";
let mpRoomId = "";
let isRoomHost = false;
let myPlayerName = "";
const playerStats = {};

function mpConnected() {
  return mpSocket !== null && mpSocket.readyState === WebSocket.OPEN;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensurePlayer(id, name = "Player") {
  if (!id) return;
  if (!playerStats[id]) {
    playerStats[id] = { name, score: 0, treasure: 0, heart: 0, fish: 0, poop: 0, crab: 0, crown: 0, bombHit: 0 };
  } else if (name) {
    playerStats[id].name = name;
  }
}

function removePlayer(id) {
  delete playerStats[id];
}

function mergePeersRoster(peers) {
  (peers || []).forEach((p) => {
    if (p && p.id) ensurePlayer(p.id, p.name || "Player");
  });
}

function myStat() {
  return playerStats[mpClientId] || { score: 0, treasure: 0, heart: 0, fish: 0, poop: 0, crab: 0, crown: 0, bombHit: 0 };
}

function renderLeaderboard() {
  const sorted = Object.entries(playerStats).sort((a, b) => {
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    return String(a[1].name || "").localeCompare(String(b[1].name || ""));
  });
  const rows = sorted
    .map(([id, p], idx) => {
      const rank = idx + 1;
      const me = id === mpClientId ? " (ban)" : "";
      return `<div class="leaderboard-item"><span class="lb-rank">#${rank}</span><span class="lb-name">${p.name}${me}</span><strong>${p.score} diem | 💣${p.bombHit}</strong></div>`;
    })
    .join("");
  leaderboard.innerHTML = `<h3>Bang diem phong</h3>${rows || "<div class='leaderboard-item'>Chua co nguoi choi</div>"}`;
}

function renderRandomCounts() {
  if (!randomCountsText) return;
  randomCountsText.textContent =
    `Random map: 💣${currentRandomCounts.bomb} | 💎${currentRandomCounts.treasure} | ❤️${currentRandomCounts.heart} | ` +
    `🐟${currentRandomCounts.fish} | 💩${currentRandomCounts.poop} | 🦀${currentRandomCounts.crab} | 👑${currentRandomCounts.crown}`;
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function updateHud() {
  const me = myStat();
  setText(scoreText, String(me.score));
  setText(treasureText, String(me.treasure));
  setText(heartText, String(me.heart ?? 0));
  setText(fishText, String(me.fish ?? 0));
  setText(poopText, String(me.poop ?? 0));
  setText(crabText, String(me.crab ?? 0));
  setText(crownText, String(me.crown ?? 0));
  setText(bombText, String(me.bombHit));
  setText(stateText, gameActive ? "Dang choi" : "Da dung");
  renderRandomCounts();
  renderLeaderboard();
}

function applyHostPermissions() {
  const host = isRoomHost;
  hostTotalWrap.classList.toggle("section-hidden", !host);
  hostBombWrap.classList.toggle("section-hidden", !host);
  startBtn.classList.toggle("section-hidden", !host);
  resetBtn.classList.toggle("section-hidden", !host);
  guestLoadingText.classList.toggle("section-hidden", host);
}

function applyRandomBackground() {
  document.body.classList.remove(...BACKGROUND_THEMES);
  document.body.classList.add(BACKGROUND_THEMES[randInt(0, BACKGROUND_THEMES.length - 1)]);
}

function syncTileSizeForScreen() {
  const base = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(56, Math.min(94, Math.round(base * 0.09)));
  document.documentElement.style.setProperty("--btn-size", `${size}px`);
}

function getTileSize() {
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--btn-size"));
  return Number.isFinite(v) ? v : 64;
}

function clearArenaButtons() {
  arena.querySelectorAll(".tile").forEach((btn) => btn.remove());
}

function normalizeConfig() {
  const total = Math.max(2, Math.min(250, Number(totalButtonsInput.value) || 25));
  let bombCount = Math.max(1, Number(bombCountInput.value) || 5);
  bombCount = Math.min(total - 1, bombCount);
  totalButtonsInput.value = String(total);
  bombCountInput.value = String(bombCount);
  return { total, bombCount };
}

function getRandomPositions(total) {
  const padding = 8;
  const minGap = 10;
  const arenaWidth = Math.max(320, arena.clientWidth);
  const arenaHeight = Math.max(320, arena.clientHeight);
  let size = getTileSize();
  const available = Math.max(1, (arenaWidth - padding * 2) * (arenaHeight - padding * 2));
  const estimated = Math.floor(Math.sqrt(available / Math.max(1, total)) - minGap);
  if (estimated > 0 && total > 36) {
    size = Math.max(38, Math.min(size, estimated));
    document.documentElement.style.setProperty("--btn-size", `${size}px`);
  }
  const step = size + minGap;
  const cols = Math.max(1, Math.floor((arenaWidth - padding * 2 + minGap) / step));
  const rows = Math.max(1, Math.floor((arenaHeight - padding * 2 + minGap) / step));
  const capacity = cols * rows;
  const finalTotal = Math.min(total, capacity);
  totalButtonsInput.value = String(finalTotal);
  const grid = [];
  const offsetX = Math.max(padding, Math.floor((arenaWidth - cols * step + minGap) / 2));
  const offsetY = Math.max(padding, Math.floor((arenaHeight - rows * step + minGap) / 2));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) grid.push({ x: offsetX + c * step, y: offsetY + r * step });
  }
  for (let i = grid.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [grid[i], grid[j]] = [grid[j], grid[i]];
  }
  return grid.slice(0, finalTotal);
}

function pickRoles(total, bombCount) {
  const bombs = new Set();
  while (bombs.size < bombCount) bombs.add(randInt(0, total - 1));
  bombSet = bombs;

  roleSets = {
    treasure: new Set(),
    heart: new Set(),
    fish: new Set(),
    poop: new Set(),
    crab: new Set(),
    crown: new Set()
  };

  const available = [];
  for (let i = 0; i < total; i += 1) {
    if (!bombs.has(i)) available.push(i);
  }

  const takeRandom = (count) => {
    const picked = [];
    for (let i = 0; i < count && available.length > 0; i += 1) {
      const idx = randInt(0, available.length - 1);
      picked.push(available[idx]);
      available.splice(idx, 1);
    }
    return picked;
  };

  const assignRole = (role, minCount, maxCount) => {
    if (available.length <= 0) return;
    const n = randInt(Math.min(minCount, available.length), Math.min(maxCount, available.length));
    takeRandom(n).forEach((x) => roleSets[role].add(x));
  };

  assignRole("treasure", 1, 6);
  assignRole("heart", 1, 4);
  assignRole("fish", 1, 4);
  assignRole("poop", 1, 3);
  assignRole("crab", 1, 3);
  assignRole("crown", 1, 2);

  currentRandomCounts = {
    bomb: bombSet.size,
    treasure: roleSets.treasure.size,
    heart: roleSets.heart.size,
    fish: roleSets.fish.size,
    poop: roleSets.poop.size,
    crab: roleSets.crab.size,
    crown: roleSets.crown.size
  };
}

function createShuffledNumbers(total) {
  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function setupHiddenTile(btn, order, role) {
  btn.classList.remove("safe", "treasure", "bomb", "heart", "fish", "poop", "crab", "crown", "vanished", "vanish");
  btn.classList.add("hidden");
  btn.dataset.revealed = "false";
  btn.dataset.role = role;
  btn.dataset.order = String(order);
  btn.textContent = String(order);
}

function applyVanishedSafe(btn) {
  btn.classList.remove("safe", "vanish");
  btn.classList.add("vanished");
  btn.textContent = "";
}

function revealTile(btn, role, opts = {}) {
  const { instant = false, onDone } = opts;
  btn.classList.remove("hidden", "safe", "treasure", "bomb", "heart", "fish", "poop", "crab", "crown", "vanished", "vanish");
  if (role === "treasure") {
    btn.classList.add("treasure");
    btn.textContent = "💎";
    if (onDone) onDone();
  } else if (role === "bomb") {
    btn.classList.add("bomb");
    btn.textContent = "💣";
    if (onDone) onDone();
  } else if (role === "heart") {
    btn.classList.add("heart");
    btn.textContent = "❤️";
    if (onDone) onDone();
  } else if (role === "fish") {
    btn.classList.add("fish");
    btn.textContent = "🐟";
    if (onDone) onDone();
  } else if (role === "poop") {
    btn.classList.add("poop");
    btn.textContent = "💩";
    if (onDone) onDone();
  } else if (role === "crab") {
    btn.classList.add("crab");
    btn.textContent = "🦀";
    if (onDone) onDone();
  } else if (role === "crown") {
    btn.classList.add("crown");
    btn.textContent = "👑";
    if (onDone) onDone();
  } else {
    btn.classList.add("safe");
    if (instant) {
      applyVanishedSafe(btn);
      if (onDone) onDone();
    } else {
      btn.textContent = "";
      btn.classList.add("vanish");
      let finished = false;
      let safetyId = 0;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(safetyId);
        btn.removeEventListener("animationend", done);
        applyVanishedSafe(btn);
        if (onDone) onDone();
      };
      const done = (ev) => {
        if (ev.animationName !== "tileVanish") return;
        finish();
      };
      btn.addEventListener("animationend", done);
      safetyId = setTimeout(finish, 750);
    }
  }
}

function sendRoomMsg(data, { excludeSelf = false, toHostOnly = false } = {}) {
  if (!mpConnected()) return;
  mpSocket.send(JSON.stringify({ type: "room_msg", data, excludeSelf, toHostOnly }));
}

function getThemeClass() {
  if (document.body.classList.contains("bg-space")) return "bg-space";
  if (document.body.classList.contains("bg-landscape")) return "bg-landscape";
  return "bg-ocean";
}

function broadcastFullState() {
  if (!mpConnected() || !isRoomHost || applyingRemoteState) return;
  const w = Math.max(1, hostArenaWidth);
  const h = Math.max(1, hostArenaHeight);
  const tiles = cells.map((btn) => ({
    nx: parseFloat(btn.style.left) / w,
    ny: parseFloat(btn.style.top) / h,
    order: Number(btn.dataset.order),
    role: btn.dataset.role,
    revealed: btn.dataset.revealed === "true"
  }));
  sendRoomMsg(
    {
      kind: "full_state",
      gameActive,
      theme: getThemeClass(),
      totalInput: totalButtonsInput.value,
      bombInput: bombCountInput.value,
      playerStats,
      randomCounts: currentRandomCounts,
      tiles
    },
    { excludeSelf: true }
  );
}

function applyFullState(payload) {
  applyingRemoteState = true;
  try {
    gameActive = Boolean(payload.gameActive);
    totalButtonsInput.value = String(payload.totalInput ?? totalButtonsInput.value);
    bombCountInput.value = String(payload.bombInput ?? bombCountInput.value);

    Object.keys(playerStats).forEach((k) => delete playerStats[k]);
    Object.entries(payload.playerStats || {}).forEach(([k, v]) => {
      playerStats[k] = {
        name: v.name,
        score: v.score,
        treasure: v.treasure,
        heart: v.heart ?? 0,
        fish: v.fish ?? 0,
        poop: v.poop ?? 0,
        crab: v.crab ?? 0,
        crown: v.crown ?? 0,
        bombHit: v.bombHit || 0
      };
    });
    ensurePlayer(mpClientId, myPlayerName);
    currentRandomCounts = {
      bomb: Number(payload?.randomCounts?.bomb ?? 0),
      treasure: Number(payload?.randomCounts?.treasure ?? 0),
      heart: Number(payload?.randomCounts?.heart ?? 0),
      fish: Number(payload?.randomCounts?.fish ?? 0),
      poop: Number(payload?.randomCounts?.poop ?? 0),
      crab: Number(payload?.randomCounts?.crab ?? 0),
      crown: Number(payload?.randomCounts?.crown ?? 0)
    };

    document.body.classList.remove(...BACKGROUND_THEMES);
    document.body.classList.add(BACKGROUND_THEMES.includes(payload.theme) ? payload.theme : "bg-ocean");
    overlay.classList.remove("show");

    clearArenaButtons();
    cells = [];
    const aw = Math.max(1, arena.clientWidth);
    const ah = Math.max(1, arena.clientHeight);
    (payload.tiles || []).forEach((t, idx) => {
      const btn = document.createElement("button");
      btn.className = "tile";
      btn.type = "button";
      btn.setAttribute("aria-label", `o-${idx + 1}`);
      btn.style.left = `${(t.nx ?? 0) * aw}px`;
      btn.style.top = `${(t.ny ?? 0) * ah}px`;
      if (t.revealed) {
        btn.dataset.revealed = "true";
        btn.dataset.role = t.role;
        btn.dataset.order = String(t.order);
        if (t.role === "safe") {
          revealTile(btn, "safe", { instant: true });
        } else {
          revealTile(btn, t.role);
        }
      } else {
        setupHiddenTile(btn, t.order, t.role);
      }
      btn.addEventListener("click", () => handleTileClick(btn));
      cells.push(btn);
      arena.appendChild(btn);
    });
    updateHud();
  } finally {
    applyingRemoteState = false;
  }
}

function endGame() {
  gameActive = false;
  updateHud();
  resultTitle.textContent = "Ket thuc";
  resultText.innerHTML = "Khong con o nao de mo.";
  overlay.classList.add("show");
  messageText.textContent = "Van choi ket thuc. Doi chu phong Start game moi.";
  if (isRoomHost) broadcastFullState();
}

function updatePlayerScore(playerId, role) {
  ensurePlayer(playerId, playerId === mpClientId ? myPlayerName : "Player");
  const p = playerStats[playerId];
  if (role === "bomb") {
    p.bombHit += 1;
    const penalty = p.bombHit * 10;
    p.score -= penalty;
    return;
  }
  p.score += 1;
  if (ROLE_EXTRA_SCORE[role] !== undefined) {
    p.score += ROLE_EXTRA_SCORE[role];
  }
  if (role === "treasure" || role === "heart" || role === "fish" || role === "poop" || role === "crab" || role === "crown") {
    p[role] = (p[role] || 0) + 1;
  }
}

function hasAnyHiddenTile() {
  return cells.some((btn) => btn.dataset.revealed !== "true");
}

function handleTileClick(btn, actorId = mpClientId) {
  if (!gameActive) return;
  if (btn.dataset.revealed === "true") return;

  if (mpConnected() && !isRoomHost) {
    if (btn.dataset.role === "treasure") playTreasureSound();
    else if (btn.dataset.role === "bomb") playBoomSound();
    sendRoomMsg({ kind: "guest_click", order: Number(btn.dataset.order) }, { toHostOnly: true });
    return;
  }

  const role = btn.dataset.role;
  btn.dataset.revealed = "true";
  if (role === "treasure") playTreasureSound();
  else if (role === "bomb") playBoomSound();

  const afterScoreAndMessage = () => {
    updatePlayerScore(actorId, role);
    updateHud();

    if (!hasAnyHiddenTile()) {
      endGame();
      return;
    }

    if (role === "bomb") {
      const bombHits = playerStats[actorId]?.bombHit || 0;
      messageText.textContent = `Trung boom! Lan ${bombHits}: -${bombHits * 10} diem.`;
    } else if (role === "treasure") {
      messageText.textContent = "Tim thay kho bau! +1 (o dung) +10 = +11 diem.";
    } else if (role === "heart") {
      messageText.textContent = "Tim thay tim! +1 (o dung) +50 = +51 diem.";
    } else if (role === "fish") {
      messageText.textContent = "Tim thay ca! +1 (o dung) +7 = +8 diem.";
    } else if (role === "poop") {
      messageText.textContent = "Dap trung shit! +1 (o dung) -15 = -14 diem.";
    } else if (role === "crab") {
      messageText.textContent = "Tim thay cua! +1 (o dung) +5 = +6 diem.";
    } else if (role === "crown") {
      messageText.textContent = "Nhat duoc vuong mien! +1 (o dung) +30 = +31 diem.";
    } else {
      messageText.textContent = "O trong. +1 diem (o dung).";
    }

    if (isRoomHost) broadcastFullState();
  };

  revealTile(btn, role, { onDone: afterScoreAndMessage });
}

function randomizeMap() {
  const { total, bombCount } = normalizeConfig();
  const positions = getRandomPositions(total);
  const realTotal = positions.length;
  const realBomb = Math.min(bombCount, Math.max(1, realTotal - 1));
  const numbers = createShuffledNumbers(realTotal);

  pickRoles(realTotal, realBomb);
  hostArenaWidth = Math.max(1, arena.clientWidth);
  hostArenaHeight = Math.max(1, arena.clientHeight);
  clearArenaButtons();
  cells = [];

  for (let i = 0; i < realTotal; i += 1) {
    const btn = document.createElement("button");
    btn.className = "tile";
    btn.type = "button";
    btn.setAttribute("aria-label", `o-${i + 1}`);
    btn.style.left = `${positions[i].x}px`;
    btn.style.top = `${positions[i].y}px`;
    let role = "safe";
    if (roleSets.treasure.has(i)) role = "treasure";
    else if (roleSets.heart.has(i)) role = "heart";
    else if (roleSets.fish.has(i)) role = "fish";
    else if (roleSets.poop.has(i)) role = "poop";
    else if (roleSets.crab.has(i)) role = "crab";
    else if (roleSets.crown.has(i)) role = "crown";
    else if (bombSet.has(i)) role = "bomb";
    setupHiddenTile(btn, numbers[i], role);
    btn.addEventListener("click", () => handleTileClick(btn));
    cells.push(btn);
    arena.appendChild(btn);
  }
  updateHud();
  messageText.textContent = "Bat dau! Click tu do de mo o.";
}

function startGame(resetPoint = false) {
  if (!isRoomHost) {
    messageText.textContent = "Chi chu phong moi duoc Start.";
    return;
  }
  if (resetPoint) {
    Object.values(playerStats).forEach((p) => {
      p.score = 0;
      p.treasure = 0;
      p.heart = 0;
      p.fish = 0;
      p.poop = 0;
      p.crab = 0;
      p.crown = 0;
      p.bombHit = 0;
    });
  }
  gameActive = true;
  overlay.classList.remove("show");
  applyRandomBackground();
  syncTileSizeForScreen();
  randomizeMap();
  broadcastFullState();
}

function connectMultiplayer() {
  const playerName = (playerNameInput.value || "").trim();
  if (!playerName) {
    messageText.textContent = "Hay nhap ten nguoi choi.";
    return;
  }
  const roomId = FIXED_ROOM_ID;
  myPlayerName = playerName;
  mpStatusText.textContent = "Dang ket noi...";
  if (mpSocket) mpSocket.close();

  mpSocket = new WebSocket(WS_SERVER_URL);
  mpSocket.addEventListener("open", () => {
    mpSocket.send(JSON.stringify({ type: "join", roomId, playerName }));
  });

  mpSocket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    if (msg.type === "joined") {
      mpClientId = msg.clientId;
      mpRoomId = msg.roomId;
      isRoomHost = Boolean(msg.isHost);
      Object.keys(playerStats).forEach((k) => delete playerStats[k]);
      mergePeersRoster(msg.peers);
      ensurePlayer(mpClientId, myPlayerName);
      stepConnect.classList.add("section-hidden");
      stepGame.classList.remove("section-hidden");
      applyHostPermissions();
      updateHud();
      mpStatusText.textContent = isRoomHost ? `Host · ${mpRoomId}` : `Khach · ${mpRoomId}`;
      messageText.textContent = isRoomHost
        ? "Ban la chu phong. Cau hinh va bam Start game."
        : "Dang doi chu phong start game...";
      if (!isRoomHost) sendRoomMsg({ kind: "need_state" }, { toHostOnly: true });
      return;
    }

    if (msg.type === "room_roster" && Array.isArray(msg.peers)) {
      mergePeersRoster(msg.peers);
      ensurePlayer(mpClientId, myPlayerName);
      updateHud();
      if (isRoomHost) broadcastFullState();
      return;
    }

    if (msg.type === "peer_joined" && msg.player) {
      ensurePlayer(msg.player.id, msg.player.name);
      updateHud();
      return;
    }

    if (msg.type === "peer_left" && msg.playerId) {
      removePlayer(msg.playerId);
      updateHud();
      return;
    }

    if (msg.type === "promoted_host") {
      isRoomHost = true;
      applyHostPermissions();
      messageText.textContent = "Ban la host moi. Co the Start game.";
      return;
    }

    if (msg.type === "room_msg" && msg.data) {
      const data = msg.data;
      if (data.kind === "full_state") {
        applyFullState(data);
      } else if (data.kind === "need_state" && isRoomHost) {
        broadcastFullState();
      } else if (data.kind === "guest_click" && isRoomHost) {
        const btn = cells.find(
          (x) => Number(x.dataset.order) === Number(data.order) && x.dataset.revealed !== "true"
        );
        if (btn) handleTileClick(btn, msg.from);
      } else if (data.kind === "chicken_start" && isRoomHost) {
        chickenStartGame();
      } else if (data.kind === "chicken_need_state" && isRoomHost) {
        chickenSyncState();
      } else if (data.kind === "chicken_input") {
        chickenHandleRemoteInput(data, msg.from);
      } else if (data.kind === "chicken_full_state" && !isRoomHost) {
        chickenApplyState(data.state || {});
      }
    }
  });

  mpSocket.addEventListener("close", () => {
    mpStatusText.textContent = "Offline";
  });
  mpSocket.addEventListener("error", () => {
    mpStatusText.textContent = "Loi ket noi";
  });
}

startBtn.addEventListener("click", () => startGame(false));
playAgainBtn.addEventListener("click", () => startGame(false));
resetBtn.addEventListener("click", () => startGame(true));
mpConnectBtn.addEventListener("click", connectMultiplayer);

window.addEventListener("resize", () => {
  syncTileSizeForScreen();
  if (gameActive && !mpConnected()) randomizeMap();
});

function buildSineWavBlob(freqHz, durationSec, sampleRate = 24000) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  let o = 0;
  const w = (s) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(o++, s.charCodeAt(i));
  };
  w("RIFF");
  v.setUint32(o, 36 + dataSize, true);
  o += 4;
  w("WAVE");
  w("fmt ");
  v.setUint32(o, 16, true);
  o += 4;
  v.setUint16(o, 1, true);
  o += 2;
  v.setUint16(o, 1, true);
  o += 2;
  v.setUint32(o, sampleRate, true);
  o += 4;
  v.setUint32(o, sampleRate * 2, true);
  o += 4;
  v.setUint16(o, 2, true);
  o += 2;
  v.setUint16(o, 16, true);
  o += 2;
  w("data");
  v.setUint32(o, dataSize, true);
  o += 4;
  const vol = 0.22;
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, i / 80);
    const fadeOut = Math.min(1, (numSamples - i) / 120);
    const env = fadeIn * fadeOut;
    const s = Math.sin(2 * Math.PI * freqHz * t) * vol * env;
    v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
    o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const MINI_AUDIO_BASE = "assets/mini/";
const MINI_ALPHABET_BASE = "assets/alphabet-eng/";

const MINI_ALPHABET_SPEAK_VI = [
  "Ây",
  "Bi",
  "Xi",
  "Đi",
  "I",
  "E-ph",
  "Gi",
  "E-i-chơ",
  "Ai",
  "Giê-i",
  "Kê-i",
  "E-Lơ",
  "Em",
  "En",
  "Ôu",
  "Pi",
  "Ky-u",
  "A-rơ",
  "E-Xơ",
  "Ti",
  "Yu",
  "Vi",
  "Đa-bơn Du",
  "I-Xơ",
  "Uai",
  "De-đơ"
];

const ENGLISH_ALPHABET_26 = "abcdefghijklmnopqrstuvwxyz".split("").map((key, i) => ({
  key,
  label: key.toUpperCase(),
  file: `${key}.mp3`,
  speak: MINI_ALPHABET_SPEAK_VI[i],
  freq: 200 + i * 15,
  dur: 0.28
}));

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getAlphabetVisibleCount() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = Math.min(w, h);
  const L = Math.max(w, h);
  if (s < 360) return 4;
  if (s < 420) return 6;
  if (s < 520) return 8;
  if (s < 640) return w >= 400 ? 10 : 8;
  if (s < 768) return 12;
  if (L < 900) return 12;
  if (L < 1024) return 16;
  if (L < 1280) return 20;
  return 26;
}

function computeBestMiniCols(n, W, H, gap) {
  let bestCols = 1;
  let bestSide = 0;
  for (let c = 1; c <= n; c += 1) {
    const r = Math.ceil(n / c);
    const cellW = (W - gap * (c - 1)) / c;
    const cellH = (H - gap * (r - 1)) / r;
    const side = Math.min(cellW, cellH);
    if (side > bestSide) {
      bestSide = side;
      bestCols = c;
    }
  }
  return { cols: bestCols, rows: Math.ceil(n / bestCols) };
}

function layoutMiniStage(stageEl, n) {
  if (!stageEl || !n) return;
  const cr = stageEl.getBoundingClientRect();
  const W = Math.max(80, cr.width);
  const H = Math.max(80, cr.height);
  const gap = Math.round(Math.max(5, Math.min(18, Math.min(W, H) * 0.018)));
  const { cols, rows } = computeBestMiniCols(n, W, H, gap);
  stageEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  stageEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  stageEl.style.gap = `${gap}px`;
  const cellW = (W - gap * (cols - 1)) / cols;
  const cellH = (H - gap * (rows - 1)) / rows;
  const side = Math.min(cellW, cellH);
  const fs = Math.max(14, Math.min(80, side * 0.45));
  stageEl.style.setProperty("--mini-tile-fs", `${Math.round(fs)}px`);
}

let miniViewLayoutObserver = null;

function ensureMiniViewLayoutObserver() {
  const view = document.getElementById("viewMini");
  if (!view || miniViewLayoutObserver) return;
  let t = 0;
  miniViewLayoutObserver = new ResizeObserver(() => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      if (view.classList.contains("section-hidden")) return;
      const stage = document.getElementById("letterTiles");
      const count = stage?.children?.length;
      if (stage && count && stage.dataset.inited === "1") layoutMiniStage(stage, count);
    }, 48);
  });
  miniViewLayoutObserver.observe(view);
}

function miniItemSpeakText(item) {
  if (item.speak && String(item.speak).trim()) return String(item.speak).trim();
  if (item.icon && !item.label) return "Con cá";
  if (item.label) return `Chữ ${item.label}`;
  return "";
}

const miniAudioRuntime = { howls: [], blobUrls: [] };

function miniAudioDisposeAll() {
  miniAudioRuntime.howls.forEach((x) => x && x.unload());
  miniAudioRuntime.blobUrls.forEach((u) => URL.revokeObjectURL(u));
  miniAudioRuntime.howls = [];
  miniAudioRuntime.blobUrls = [];
}

function setMiniLoading(loading) {
  const loader = document.getElementById("miniLoader");
  if (!loader) return;
  loader.classList.toggle("section-hidden", !loading);
  loader.setAttribute("aria-busy", loading ? "true" : "false");
}

function miniGameTeardown() {
  setMiniLoading(false);
  miniAudioDisposeAll();
  const el = document.getElementById("letterTiles");
  if (el) {
    el.innerHTML = "";
    el.dataset.inited = "";
  }
}

function pickSouthernVietnameseVoice() {
  if (!window.speechSynthesis) return null;
  const list = speechSynthesis.getVoices();
  const vi = list.filter((v) => /^vi/i.test(v.lang || ""));
  if (!vi.length) return null;
  const key = (v) => `${v.name} ${v.lang}`.toLowerCase();
  const rank = (v) => {
    const k = key(v);
    if (
      /mien nam|miền nam|sai gon|sài gòn|saigon|ho chi minh|hồ chí minh|hcms|nam bo|nam bộ|south vietnam|southern/.test(
        k
      )
    )
      return 4;
    if (/viet nam|vietnam|vietnamese|tieng viet|tiếng việt/.test(k)) return 2;
    return 1;
  };
  return [...vi].sort((a, b) => rank(b) - rank(a))[0];
}

let miniTtsVoice = null;

function refreshMiniTtsVoice() {
  miniTtsVoice = pickSouthernVietnameseVoice();
}

function speakMiniTts(text) {
  if (!text || !window.speechSynthesis) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "vi-VN";
    if (miniTtsVoice) u.voice = miniTtsVoice;
    u.rate = 0.8;
    u.pitch = 1.02;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

if (window.speechSynthesis) {
  speechSynthesis.addEventListener("voiceschanged", refreshMiniTtsVoice);
  refreshMiniTtsVoice();
}

function probeAudioFileUrl(url) {
  return new Promise((resolve) => {
    const audio = new Audio();
    const done = (ok) => {
      audio.removeAttribute("src");
      resolve(ok);
    };
    const t = setTimeout(() => done(false), 4000);
    audio.oncanplaythrough = () => {
      clearTimeout(t);
      done(true);
    };
    audio.onerror = () => {
      clearTimeout(t);
      done(false);
    };
    audio.preload = "auto";
    audio.src = url;
    audio.load();
  });
}

async function buildMiniHowl(HowlCtor, item, blobUrls, audioBase = MINI_AUDIO_BASE) {
  const freq = item.freq ?? 440;
  const dur = item.dur ?? 0.28;
  const synthUrl = URL.createObjectURL(buildSineWavBlob(freq, dur));
  blobUrls.push(synthUrl);

  if (!HowlCtor) return { howl: null, hasMp3: false };

  const rel = item.file ? `${audioBase}${item.file}` : null;
  if (rel) {
    const abs = new URL(rel, window.location.href).href;
    const ok = await probeAudioFileUrl(abs);
    if (ok) {
      URL.revokeObjectURL(synthUrl);
      blobUrls.pop();
      return {
        hasMp3: true,
        howl: new HowlCtor({
          src: [rel],
          volume: 0.92,
          preload: true,
          html5: true
        })
      };
    }
  }

  return {
    hasMp3: false,
    howl: new HowlCtor({
      src: [synthUrl],
      format: ["wav"],
      volume: 0.85,
      preload: true
    })
  };
}

async function initMiniGameDemo() {
  const letterTilesEl = document.getElementById("letterTiles");
  if (!letterTilesEl) return;

  miniGameTeardown();

  setMiniLoading(true);
  letterTilesEl.dataset.inited = "loading";

  refreshMiniTtsVoice();

  const HowlCtor = typeof Howl !== "undefined" ? Howl : null;
  const blobUrls = miniAudioRuntime.blobUrls;
  const howls = miniAudioRuntime.howls;

  const n = Math.min(getAlphabetVisibleCount(), ENGLISH_ALPHABET_26.length);
  const items = shuffleArray(ENGLISH_ALPHABET_26).slice(0, n);

  const frag = document.createDocumentFragment();

  try {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const speakLine = miniItemSpeakText(item);
      const { howl: h, hasMp3 } = await buildMiniHowl(HowlCtor, item, blobUrls, MINI_ALPHABET_BASE);
      howls.push(h);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-tile";
      btn.textContent = item.label;
      btn.setAttribute("aria-label", `Chu ${item.label}, ${speakLine}`);
      btn.addEventListener("click", () => {
        if (hasMp3 && h) {
          h.stop();
          h.play();
          return;
        }
        if (speakLine && speakMiniTts(speakLine)) return;
        if (h) {
          h.stop();
          h.play();
        }
      });
      frag.appendChild(btn);
    }
    letterTilesEl.appendChild(frag);
    letterTilesEl.dataset.inited = "1";
    setMiniLoading(false);
    ensureMiniViewLayoutObserver();
    const nTiles = items.length;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => layoutMiniStage(letterTilesEl, nTiles));
    });
  } catch (err) {
    setMiniLoading(false);
    miniGameTeardown();
    console.error(err);
  }
}

const snakeCanvas = document.getElementById("snakeCanvas");
const snakeStartBtn = document.getElementById("snakeStartBtn");
const snakeScoreText = document.getElementById("snakeScoreText");

const snakeState = {
  running: false,
  timerId: 0,
  gridSize: 20,
  dir: { x: 1, y: 0 },
  nextDir: { x: 1, y: 0 },
  snake: [],
  food: { x: 5, y: 5 },
  score: 0
};

function snakeCellSize() {
  if (!snakeCanvas) return 1;
  return snakeCanvas.width / snakeState.gridSize;
}

function spawnSnakeFood() {
  if (!snakeCanvas) return;
  const occupied = new Set(snakeState.snake.map((p) => `${p.x},${p.y}`));
  const free = [];
  for (let y = 0; y < snakeState.gridSize; y += 1) {
    for (let x = 0; x < snakeState.gridSize; x += 1) {
      const k = `${x},${y}`;
      if (!occupied.has(k)) free.push({ x, y });
    }
  }
  if (!free.length) return;
  snakeState.food = free[randInt(0, free.length - 1)];
}

function drawSnakeBoard() {
  if (!snakeCanvas) return;
  const ctx = snakeCanvas.getContext("2d");
  if (!ctx) return;
  const size = snakeCellSize();
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);

  ctx.strokeStyle = "rgba(148,163,184,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= snakeState.gridSize; i += 1) {
    const p = i * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, snakeCanvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(snakeCanvas.width, p);
    ctx.stroke();
  }

  ctx.fillStyle = "#ef4444";
  ctx.fillRect(snakeState.food.x * size + 2, snakeState.food.y * size + 2, size - 4, size - 4);

  snakeState.snake.forEach((s, idx) => {
    ctx.fillStyle = idx === 0 ? "#22c55e" : "#16a34a";
    ctx.fillRect(s.x * size + 2, s.y * size + 2, size - 4, size - 4);
  });
}

function updateSnakeScoreText() {
  if (snakeScoreText) snakeScoreText.textContent = String(snakeState.score);
}

function stopSnakeGame(showMessage = false) {
  snakeState.running = false;
  if (snakeState.timerId) {
    clearInterval(snakeState.timerId);
    snakeState.timerId = 0;
  }
  if (showMessage) {
    setTimeout(() => {
      window.alert(`Game over! Diem cua ban: ${snakeState.score}`);
    }, 20);
  }
}

function snakeStep() {
  if (!snakeState.running) return;
  snakeState.dir = { ...snakeState.nextDir };
  const head = snakeState.snake[0];
  const nh = { x: head.x + snakeState.dir.x, y: head.y + snakeState.dir.y };

  if (nh.x < 0 || nh.y < 0 || nh.x >= snakeState.gridSize || nh.y >= snakeState.gridSize) {
    stopSnakeGame(true);
    return;
  }
  if (snakeState.snake.some((p) => p.x === nh.x && p.y === nh.y)) {
    stopSnakeGame(true);
    return;
  }

  snakeState.snake.unshift(nh);
  if (nh.x === snakeState.food.x && nh.y === snakeState.food.y) {
    snakeState.score += 1;
    updateSnakeScoreText();
    spawnSnakeFood();
  } else {
    snakeState.snake.pop();
  }
  drawSnakeBoard();
}

function setSnakeDirection(dirName) {
  const map = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };
  const next = map[dirName];
  if (!next) return;
  if (next.x === -snakeState.dir.x && next.y === -snakeState.dir.y) return;
  snakeState.nextDir = next;
}

function resizeSnakeCanvas() {
  if (!snakeCanvas) return;
  const box = snakeCanvas.getBoundingClientRect();
  const side = Math.max(280, Math.min(box.width, window.innerHeight * 0.72));
  snakeCanvas.width = Math.round(side);
  snakeCanvas.height = Math.round(side);
  drawSnakeBoard();
}

function startSnakeGame() {
  if (!snakeCanvas) return;
  stopSnakeGame(false);
  snakeState.score = 0;
  updateSnakeScoreText();
  const mid = Math.floor(snakeState.gridSize / 2);
  snakeState.snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid }
  ];
  snakeState.dir = { x: 1, y: 0 };
  snakeState.nextDir = { x: 1, y: 0 };
  spawnSnakeFood();
  snakeState.running = true;
  drawSnakeBoard();
  snakeState.timerId = window.setInterval(snakeStep, 120);
}

function initSnakeBindings() {
  if (snakeStartBtn) {
    snakeStartBtn.addEventListener("click", startSnakeGame);
  }
  document.querySelectorAll("[data-snake-dir]").forEach((btn) => {
    const d = btn.getAttribute("data-snake-dir");
    btn.addEventListener("click", () => setSnakeDirection(d));
  });
  window.addEventListener("keydown", (ev) => {
    const snakeView = document.getElementById("viewSnake");
    if (!snakeView || snakeView.classList.contains("section-hidden")) return;
    const map = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right"
    };
    const d = map[ev.key];
    if (!d) return;
    ev.preventDefault();
    setSnakeDirection(d);
  });
  window.addEventListener("resize", () => {
    const snakeView = document.getElementById("viewSnake");
    if (snakeView && !snakeView.classList.contains("section-hidden")) resizeSnakeCanvas();
  });
  resizeSnakeCanvas();
  drawSnakeBoard();
}

const chickenCanvas = document.getElementById("chickenCanvas");
const chickenStartBtn = document.getElementById("chickenStartBtn");
const chickenFireBtn = document.getElementById("chickenFireBtn");
const chickenAngleInput = document.getElementById("chickenAngleInput");
const chickenPowerInput = document.getElementById("chickenPowerInput");
const chickenAngleText = document.getElementById("chickenAngleText");
const chickenPowerText = document.getElementById("chickenPowerText");
const chickenTurnText = document.getElementById("chickenTurnText");
const chickenHp1Text = document.getElementById("chickenHp1Text");
const chickenHp2Text = document.getElementById("chickenHp2Text");
const chickenEnergy1Text = document.getElementById("chickenEnergy1Text");
const chickenEnergy2Text = document.getElementById("chickenEnergy2Text");
const chickenHp1Bar = document.getElementById("chickenHp1Bar");
const chickenHp2Bar = document.getElementById("chickenHp2Bar");
const chickenEnergy1Bar = document.getElementById("chickenEnergy1Bar");
const chickenEnergy2Bar = document.getElementById("chickenEnergy2Bar");
const chickenMoveLeftBtn = document.getElementById("chickenMoveLeftBtn");
const chickenMoveRightBtn = document.getElementById("chickenMoveRightBtn");

const chickenState = {
  active: false,
  worldW: 1000,
  worldH: 600,
  gravity: 900,
  wind: 0,
  projectile: null,
  players: [],
  turnIdx: 0,
  animId: 0,
  terrain: [],
  hostControlled: false
};

function chickenCurrentPlayer() {
  return chickenState.players[chickenState.turnIdx] || null;
}

function chickenOtherPlayer() {
  return chickenState.players[(chickenState.turnIdx + 1) % 2] || null;
}

function chickenIsHostAuthority() {
  return mpConnected() ? isRoomHost : true;
}

function chickenCanControlTurn() {
  const cur = chickenCurrentPlayer();
  if (!cur) return false;
  if (!mpConnected()) return true;
  return cur.ownerId === mpClientId;
}

function chickenGroundAt(x) {
  const i = Math.max(0, Math.min(chickenState.worldW - 1, Math.round(x)));
  return chickenState.terrain[i] ?? (chickenState.worldH - 40);
}

function chickenProjectileTerrainHit(prev, next, hitR) {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(10, Math.min(48, Math.ceil(dist / 6)));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = prev.x + dx * t;
    const y = prev.y + dy * t;
    if (x < 0 || x > chickenState.worldW) {
      const cx = Math.max(0, Math.min(chickenState.worldW, x));
      return { x: cx, y: chickenGroundAt(cx), onTerrain: false };
    }
    const g = chickenGroundAt(x);
    if (y >= g - hitR) return { x, y: g, onTerrain: true };
  }
  return null;
}

function chickenResizeCanvas() {
  if (!chickenCanvas) return;
  const box = chickenCanvas.getBoundingClientRect();
  chickenCanvas.width = Math.max(640, Math.round(box.width));
  chickenCanvas.height = Math.max(360, Math.round(chickenCanvas.width * 9 / 16));
}

function chickenGenerateTerrain() {
  const base = chickenState.worldH - 120;
  chickenState.terrain = Array.from({ length: chickenState.worldW }, (_, x) => {
    const a = Math.sin(x * 0.012) * 24;
    const b = Math.sin(x * 0.033 + 1.8) * 16;
    return Math.max(chickenState.worldH - 190, Math.min(chickenState.worldH - 60, base + a + b));
  });
}

function chickenSpawnPlayers() {
  chickenGenerateTerrain();
  const p1x = randInt(120, 320);
  const p2x = randInt(680, 880);
  const p1Owner = mpConnected() ? mpClientId : "local-1";
  const p2Owner = mpConnected()
    ? Object.keys(playerStats).find((id) => id !== mpClientId) || mpClientId
    : "local-2";
  chickenState.players = [
    { id: 1, ownerId: p1Owner, x: p1x, y: chickenGroundAt(p1x) - 22, hp: 100, energy: 0, angle: 45, power: 70 },
    { id: 2, ownerId: p2Owner, x: p2x, y: chickenGroundAt(p2x) - 22, hp: 100, energy: 0, angle: 45, power: 70 }
  ];
  chickenState.turnIdx = randInt(0, 1);
  chickenState.projectile = null;
  chickenState.wind = randInt(-120, 120);
}

function chickenUiUpdate() {
  const p1 = chickenState.players[0];
  const p2 = chickenState.players[1];
  if (!p1 || !p2) return;
  if (chickenHp1Text) chickenHp1Text.textContent = String(Math.max(0, Math.round(p1.hp)));
  if (chickenHp2Text) chickenHp2Text.textContent = String(Math.max(0, Math.round(p2.hp)));
  if (chickenEnergy1Text) chickenEnergy1Text.textContent = String(p1.energy);
  if (chickenEnergy2Text) chickenEnergy2Text.textContent = String(p2.energy);
  if (chickenHp1Bar) chickenHp1Bar.style.width = `${Math.max(0, p1.hp)}%`;
  if (chickenHp2Bar) chickenHp2Bar.style.width = `${Math.max(0, p2.hp)}%`;
  if (chickenEnergy1Bar) chickenEnergy1Bar.style.width = `${Math.max(0, p1.energy)}%`;
  if (chickenEnergy2Bar) chickenEnergy2Bar.style.width = `${Math.max(0, p2.energy)}%`;
  if (chickenTurnText) chickenTurnText.textContent = chickenCurrentPlayer() ? `P${chickenCurrentPlayer().id}` : "-";
  if (chickenAngleText && chickenAngleInput) chickenAngleText.textContent = `${chickenAngleInput.value}°`;
  if (chickenPowerText && chickenPowerInput) chickenPowerText.textContent = `${chickenPowerInput.value}%`;
}

function chickenWorldToScreen(x, y) {
  if (!chickenCanvas) return { x, y };
  return {
    x: x / chickenState.worldW * chickenCanvas.width,
    y: y / chickenState.worldH * chickenCanvas.height
  };
}

/** Sprite ga (nhin phai); P2 lat bang scale(-1,1). */
function chickenDrawPlayerSprite(ctx, playerId, sx, sy) {
  const p1 = playerId === 1;
  const body = p1 ? "#facc15" : "#fb7185";
  const bodyDeep = p1 ? "#eab308" : "#f43f5e";
  const head = p1 ? "#fde047" : "#fda4af";
  const comb = "#dc2626";
  const beak = "#ea580c";
  const eye = "#111827";
  const leg = "#b45309";

  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(playerId === 1 ? 1 : -1, 1);

  ctx.fillStyle = leg;
  ctx.fillRect(-5, 12, 3, 7);
  ctx.fillRect(4, 12, 3, 7);

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 2, 17, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyDeep;
  ctx.beginPath();
  ctx.ellipse(-7, 4, 8, 7, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(13, -9, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = comb;
  ctx.beginPath();
  ctx.moveTo(7, -16);
  ctx.quadraticCurveTo(9, -22, 11, -17);
  ctx.quadraticCurveTo(13, -23, 15, -17);
  ctx.quadraticCurveTo(17, -22, 19, -15);
  ctx.lineTo(11, -14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = beak;
  ctx.beginPath();
  ctx.moveTo(21, -8);
  ctx.lineTo(29, -6);
  ctx.lineTo(21, -4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(17, -11, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f9fafb";
  ctx.beginPath();
  ctx.arc(17.6, -11.6, 0.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function chickenDraw() {
  if (!chickenCanvas) return;
  const ctx = chickenCanvas.getContext("2d");
  if (!ctx) return;
  const W = chickenCanvas.width;
  const H = chickenCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#1d4ed8");
  grd.addColorStop(1, "#065f46");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x < chickenState.worldW; x += 4) {
    const s = chickenWorldToScreen(x, chickenGroundAt(x));
    ctx.lineTo(s.x, s.y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  chickenState.players.forEach((p) => {
    const s = chickenWorldToScreen(p.x, p.y);
    chickenDrawPlayerSprite(ctx, p.id, s.x, s.y);
  });

  const shooter = chickenCurrentPlayer();
  if (shooter && !chickenState.projectile) {
    const s = chickenWorldToScreen(shooter.x, shooter.y);
    const a = (Number(chickenAngleInput?.value || shooter.angle || 45) * Math.PI) / 180;
    const dir = shooter.id === 1 ? 1 : -1;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(a) * 50 * dir, s.y - Math.sin(a) * 50);
    ctx.stroke();
  }

  if (chickenState.projectile) {
    const p = chickenState.projectile;
    const s = chickenWorldToScreen(p.x, p.y);
    ctx.fillStyle = p.super ? "#f97316" : "#f8fafc";
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.radius / chickenState.worldW * W, 0, Math.PI * 2);
    ctx.fill();
  }
}

function chickenEndTurn() {
  chickenState.projectile = null;
  const current = chickenCurrentPlayer();
  if (current) current.energy = Math.min(100, current.energy + 35);
  chickenState.turnIdx = (chickenState.turnIdx + 1) % 2;
  const next = chickenCurrentPlayer();
  if (next && chickenAngleInput) chickenAngleInput.value = String(next.angle || 45);
  if (next && chickenPowerInput) chickenPowerInput.value = String(next.power || 70);
  chickenUiUpdate();
  chickenSyncState();
}

function chickenDestroyTerrain(cx, radius) {
  const r = Math.max(8, radius);
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(chickenState.worldW - 1, Math.ceil(cx + r));
  for (let x = minX; x <= maxX; x += 1) {
    const dx = x - cx;
    const inside = r * r - dx * dx;
    if (inside <= 0) continue;
    const depth = Math.sqrt(inside);
    chickenState.terrain[x] = Math.min(chickenState.worldH - 20, chickenGroundAt(x) + depth * 0.55);
  }
  chickenState.players.forEach((pl) => {
    pl.y = chickenGroundAt(pl.x) - 22;
  });
}

function chickenExplode(x, y, radius, dmg) {
  chickenDestroyTerrain(x, radius * 0.95);
  chickenState.players.forEach((pl) => {
    const dx = pl.x - x;
    const dy = pl.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= radius) {
      const ratio = 1 - dist / radius;
      pl.hp = Math.max(0, pl.hp - dmg * ratio);
    }
  });
  chickenUiUpdate();
  const dead = chickenState.players.find((p) => p.hp <= 0);
  if (dead) {
    chickenState.active = false;
    chickenState.projectile = null;
    chickenSyncState();
    setTimeout(() => window.alert(`P${dead.id} thua!`), 10);
    return;
  }
  chickenEndTurn();
}

function chickenTick(ts) {
  if (!chickenState.active) return;
  const p = chickenState.projectile;
  if (p) {
    const dt = 1 / 60;
    const prev = { x: p.x, y: p.y };
    p.vx += chickenState.wind * dt * 0.08;
    p.vy += chickenState.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const hitR = Math.max(4, p.radius * 0.45);
    if (p.y < 0) {
      chickenExplode(Math.max(0, Math.min(chickenState.worldW, p.x)), 0, p.blast, p.damage);
    } else {
      const hit = chickenProjectileTerrainHit(prev, { x: p.x, y: p.y }, hitR);
      if (hit) {
        const ex = Math.max(0, Math.min(chickenState.worldW, hit.x));
        const ey = hit.onTerrain ? hit.y : chickenGroundAt(ex);
        chickenExplode(ex, ey, p.blast, p.damage);
      }
    }
  }
  chickenDraw();
  chickenState.animId = window.requestAnimationFrame(chickenTick);
}

function chickenMovePlayer(dx) {
  if (!chickenState.active || chickenState.projectile) return;
  if (!chickenCanControlTurn()) return;
  const p = chickenCurrentPlayer();
  if (!p) return;
  p.x = Math.max(24, Math.min(chickenState.worldW - 24, p.x + dx));
  p.y = chickenGroundAt(p.x) - 22;
  chickenSyncState();
  chickenDraw();
}

function chickenShoot() {
  if (!chickenState.active || chickenState.projectile) return;
  if (!chickenCanControlTurn()) return;
  const shooter = chickenCurrentPlayer();
  if (!shooter) return;
  const angle = Math.max(10, Math.min(80, Number(chickenAngleInput?.value || shooter.angle || 45)));
  const powerPct = Math.max(30, Math.min(100, Number(chickenPowerInput?.value || shooter.power || 70)));
  shooter.angle = angle;
  shooter.power = powerPct;
  const a = (angle * Math.PI) / 180;
  const dir = shooter.id === 1 ? 1 : -1;
  const superShot = shooter.energy >= 100;
  if (superShot) shooter.energy = 0;
  const base = 560 + powerPct * 4;
  const power = superShot ? base * 1.22 : base;
  const radius = superShot ? 20 : 4;
  const blast = superShot ? 150 : 60;
  const damage = superShot ? 65 : 30;
  chickenState.projectile = {
    x: shooter.x + dir * 20,
    y: shooter.y - 20,
    vx: Math.cos(a) * power * dir,
    vy: -Math.sin(a) * power,
    radius,
    blast,
    damage,
    super: superShot
  };
  chickenUiUpdate();
  chickenSyncState();
}

function chickenTapShoot() {
  const view = document.getElementById("viewChicken");
  if (!view || view.classList.contains("section-hidden")) return;
  chickenShoot();
}

function chickenStartGame() {
  if (mpConnected() && !isRoomHost) {
    sendRoomMsg({ kind: "chicken_start" }, { toHostOnly: true });
    return;
  }
  chickenResizeCanvas();
  chickenSpawnPlayers();
  chickenState.active = true;
  const p = chickenCurrentPlayer();
  if (p && chickenAngleInput) chickenAngleInput.value = String(p.angle);
  if (p && chickenPowerInput) chickenPowerInput.value = String(p.power || 70);
  chickenUiUpdate();
  if (chickenState.animId) cancelAnimationFrame(chickenState.animId);
  chickenState.animId = window.requestAnimationFrame(chickenTick);
  chickenSyncState();
}

function chickenStopGame() {
  chickenState.active = false;
  chickenState.projectile = null;
  if (chickenState.animId) {
    cancelAnimationFrame(chickenState.animId);
    chickenState.animId = 0;
  }
  chickenDraw();
}

function chickenSerializeState() {
  return {
    active: chickenState.active,
    terrain: chickenState.terrain,
    players: chickenState.players,
    turnIdx: chickenState.turnIdx,
    projectile: chickenState.projectile,
    wind: chickenState.wind
  };
}

function chickenApplyState(payload) {
  chickenState.active = Boolean(payload.active);
  chickenState.terrain = Array.isArray(payload.terrain) ? payload.terrain : [];
  chickenState.players = Array.isArray(payload.players) ? payload.players : [];
  chickenState.turnIdx = Number(payload.turnIdx || 0);
  chickenState.projectile = payload.projectile || null;
  chickenState.wind = Number(payload.wind || 0);
  const cur = chickenCurrentPlayer();
  if (cur && chickenAngleInput) chickenAngleInput.value = String(cur.angle || 45);
  if (cur && chickenPowerInput) chickenPowerInput.value = String(cur.power || 70);
  chickenUiUpdate();
  chickenDraw();
}

function chickenSyncState() {
  if (!mpConnected() || !isRoomHost) return;
  sendRoomMsg({ kind: "chicken_full_state", state: chickenSerializeState() }, { excludeSelf: true });
}

function chickenHandleRemoteInput(data, fromId) {
  if (!isRoomHost) return;
  if (!chickenState.active) return;
  const cur = chickenCurrentPlayer();
  if (!cur || cur.ownerId !== fromId) return;
  if (data.action === "move_left") chickenMovePlayer(-20);
  if (data.action === "move_right") chickenMovePlayer(20);
  if (data.action === "set_angle" && chickenAngleInput) chickenAngleInput.value = String(data.value);
  if (data.action === "set_power" && chickenPowerInput) chickenPowerInput.value = String(data.value);
  if (data.action === "shoot") chickenShoot();
}

function initChickenBindings() {
  if (chickenStartBtn) chickenStartBtn.addEventListener("click", chickenStartGame);
  if (chickenFireBtn) chickenFireBtn.addEventListener("click", chickenShoot);
  if (chickenAngleInput) {
    chickenAngleInput.addEventListener("input", () => {
      const cur = chickenCurrentPlayer();
      if (cur) cur.angle = Number(chickenAngleInput.value);
      chickenUiUpdate();
      chickenDraw();
      if (mpConnected() && !isRoomHost) {
        sendRoomMsg({ kind: "chicken_input", action: "set_angle", value: Number(chickenAngleInput.value) }, { toHostOnly: true });
      }
    });
  }
  if (chickenPowerInput) {
    chickenPowerInput.addEventListener("input", () => {
      const cur = chickenCurrentPlayer();
      if (cur) cur.power = Number(chickenPowerInput.value);
      chickenUiUpdate();
      if (mpConnected() && !isRoomHost) {
        sendRoomMsg({ kind: "chicken_input", action: "set_power", value: Number(chickenPowerInput.value) }, { toHostOnly: true });
      }
    });
  }
  if (chickenCanvas) {
    chickenCanvas.addEventListener("click", chickenTapShoot);
  }
  if (chickenMoveLeftBtn) {
    chickenMoveLeftBtn.addEventListener("click", () => {
      if (mpConnected() && !isRoomHost) {
        sendRoomMsg({ kind: "chicken_input", action: "move_left" }, { toHostOnly: true });
      } else {
        chickenMovePlayer(-20);
      }
    });
  }
  if (chickenMoveRightBtn) {
    chickenMoveRightBtn.addEventListener("click", () => {
      if (mpConnected() && !isRoomHost) {
        sendRoomMsg({ kind: "chicken_input", action: "move_right" }, { toHostOnly: true });
      } else {
        chickenMovePlayer(20);
      }
    });
  }
  window.addEventListener("keydown", (ev) => {
    const chickenView = document.getElementById("viewChicken");
    if (!chickenView || chickenView.classList.contains("section-hidden")) return;
    if (ev.code === "Space") {
      ev.preventDefault();
      if (mpConnected() && !isRoomHost) sendRoomMsg({ kind: "chicken_input", action: "shoot" }, { toHostOnly: true });
      else chickenShoot();
    }
    if (ev.key === "ArrowUp" && chickenAngleInput) {
      ev.preventDefault();
      chickenAngleInput.value = String(Math.min(80, Number(chickenAngleInput.value) + 2));
      chickenUiUpdate();
      chickenDraw();
    }
    if (ev.key === "ArrowDown" && chickenAngleInput) {
      ev.preventDefault();
      chickenAngleInput.value = String(Math.max(10, Number(chickenAngleInput.value) - 2));
      chickenUiUpdate();
      chickenDraw();
    }
    if (ev.key.toLowerCase() === "a" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (mpConnected() && !isRoomHost) sendRoomMsg({ kind: "chicken_input", action: "move_left" }, { toHostOnly: true });
      else chickenMovePlayer(-20);
    }
    if (ev.key.toLowerCase() === "d" || ev.key === "ArrowRight") {
      ev.preventDefault();
      if (mpConnected() && !isRoomHost) sendRoomMsg({ kind: "chicken_input", action: "move_right" }, { toHostOnly: true });
      else chickenMovePlayer(20);
    }
  });
  window.addEventListener("resize", () => {
    const chickenView = document.getElementById("viewChicken");
    if (!chickenView || chickenView.classList.contains("section-hidden")) return;
    chickenResizeCanvas();
    chickenDraw();
  });
  chickenResizeCanvas();
  chickenSpawnPlayers();
  chickenUiUpdate();
  chickenDraw();
}

function setupAppNavigation() {
  const viewMenu = document.getElementById("viewMenu");
  const viewTreasure = document.getElementById("viewTreasure");
  const viewMini = document.getElementById("viewMini");
  const viewSnake = document.getElementById("viewSnake");
  const viewChicken = document.getElementById("viewChicken");
  if (!viewMenu || !viewTreasure || !viewMini || !viewSnake || !viewChicken) return;

  function showAppView(name) {
    viewMenu.classList.toggle("section-hidden", name !== "menu");
    viewTreasure.classList.toggle("section-hidden", name !== "treasure");
    viewMini.classList.toggle("section-hidden", name !== "mini");
    viewSnake.classList.toggle("section-hidden", name !== "snake");
    viewChicken.classList.toggle("section-hidden", name !== "chicken");
    if (name === "mini") void initMiniGameDemo();
    if (name === "snake") resizeSnakeCanvas();
    else stopSnakeGame(false);
    if (name === "chicken") {
      chickenResizeCanvas();
      chickenDraw();
      if (mpConnected() && !isRoomHost) sendRoomMsg({ kind: "chicken_need_state" }, { toHostOnly: true });
    } else {
      chickenStopGame();
    }
  }

  document.querySelectorAll("[data-app-view]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.getAttribute("data-app-view");
      if (v === "menu" || v === "treasure" || v === "mini" || v === "snake" || v === "chicken")
        showAppView(v);
    });
  });

  showAppView("treasure");
}

window.addEventListener("beforeunload", () => miniAudioDisposeAll());

initSnakeBindings();
initChickenBindings();
setupAppNavigation();
updateHud();
applyRandomBackground();
syncTileSizeForScreen();
