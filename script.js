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
const bombText = document.getElementById("bombText");
const stateText = document.getElementById("stateText");
const messageText = document.getElementById("messageText");

const playerNameInput = document.getElementById("playerNameInput");
const mpConnectBtn = document.getElementById("mpConnectBtn");
const mpStatusText = document.getElementById("mpStatusText");

const WS_SERVER_URL = "wss://treasure-game-github-io.onrender.com";
const FIXED_ROOM_ID = "main";
const BACKGROUND_THEMES = ["bg-ocean", "bg-space", "bg-landscape"];

let gameActive = false;
let cells = [];
let bombSet = new Set();
let treasureSet = new Set();
let heartSet = new Set();
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
    playerStats[id] = { name, score: 0, treasure: 0, heart: 0, bombHit: 0 };
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
  return playerStats[mpClientId] || { score: 0, treasure: 0, heart: 0, bombHit: 0 };
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
      return `<div class="leaderboard-item"><span class="lb-rank">#${rank}</span><span class="lb-name">${p.name}${me}</span><strong>${p.score} | 💎${p.treasure} | ❤️${p.heart ?? 0} | 💣${p.bombHit}</strong></div>`;
    })
    .join("");
  leaderboard.innerHTML = `<h3>Bang diem phong</h3>${rows || "<div class='leaderboard-item'>Chua co nguoi choi</div>"}`;
}

function updateHud() {
  const me = myStat();
  scoreText.textContent = String(me.score);
  treasureText.textContent = String(me.treasure);
  heartText.textContent = String(me.heart ?? 0);
  bombText.textContent = String(me.bombHit);
  stateText.textContent = gameActive ? "Dang choi" : "Da dung";
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

  const maxTreasure = Math.max(1, Math.min(6, total - bombCount));
  const treasureCount = randInt(1, maxTreasure);
  const treasures = new Set();
  while (treasures.size < treasureCount) {
    const idx = randInt(0, total - 1);
    if (!bombs.has(idx)) treasures.add(idx);
  }
  treasureSet = treasures;

  const heartCandidates = [];
  for (let i = 0; i < total; i += 1) {
    if (!bombs.has(i) && !treasures.has(i)) heartCandidates.push(i);
  }
  const hearts = new Set();
  if (heartCandidates.length > 0) {
    const nHeart = randInt(1, Math.min(4, heartCandidates.length));
    while (hearts.size < nHeart) {
      hearts.add(heartCandidates[randInt(0, heartCandidates.length - 1)]);
    }
  }
  heartSet = hearts;
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
  btn.classList.remove("safe", "treasure", "bomb", "heart", "vanished", "vanish");
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
  btn.classList.remove("hidden", "safe", "treasure", "bomb", "heart", "vanished", "vanish");
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
        bombHit: v.bombHit || 0
      };
    });
    ensurePlayer(mpClientId, myPlayerName);

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
  if (role === "treasure") {
    p.score += 10;
    p.treasure += 1;
  } else if (role === "heart") {
    p.score += 50;
    p.heart = (p.heart || 0) + 1;
  } else if (role === "bomb") {
    p.bombHit += 1;
    const penalty = p.bombHit * 10;
    p.score -= penalty;
  } else {
    p.score = Math.max(0, p.score - 1);
  }
}

function hasAnyHiddenTile() {
  return cells.some((btn) => btn.dataset.revealed !== "true");
}

function handleTileClick(btn, actorId = mpClientId) {
  if (!gameActive) return;
  if (btn.dataset.revealed === "true") return;

  if (mpConnected() && !isRoomHost) {
    sendRoomMsg({ kind: "guest_click", order: Number(btn.dataset.order) }, { toHostOnly: true });
    return;
  }

  const role = btn.dataset.role;
  btn.dataset.revealed = "true";

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
      messageText.textContent = "Tim thay kho bau! +10 diem.";
    } else if (role === "heart") {
      messageText.textContent = "Tim thay tim! +50 diem.";
    } else {
      messageText.textContent = "O trong. -1 diem.";
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
    if (treasureSet.has(i)) role = "treasure";
    else if (heartSet.has(i)) role = "heart";
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

updateHud();
applyRandomBackground();
syncTileSizeForScreen();
