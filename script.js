const arena = document.getElementById("arena");
const overlay = document.getElementById("overlay");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const playAgainBtn = document.getElementById("playAgainBtn");
const leaderboard = document.getElementById("leaderboard");
const stepConnect = document.getElementById("stepConnect");
const stepGame = document.getElementById("stepGame");

const totalButtonsInput = document.getElementById("totalButtonsInput");
const bombCountInput = document.getElementById("bombCountInput");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");

const scoreText = document.getElementById("scoreText");
const treasureText = document.getElementById("treasureText");
const targetText = document.getElementById("targetText");
const stateText = document.getElementById("stateText");
const messageText = document.getElementById("messageText");

const playerNameInput = document.getElementById("playerNameInput");
const roomIdInput = document.getElementById("roomIdInput");
const mpConnectBtn = document.getElementById("mpConnectBtn");
const mpStatusText = document.getElementById("mpStatusText");
const WS_SERVER_URL = "wss://treasure-game-github-io.onrender.com";

let gameActive = false;
let cells = [];
let bombSet = new Set();
let treasureSet = new Set();
let currentTargetNumber = null;
let hostArenaWidth = 1;
let hostArenaHeight = 1;
let applyingRemoteState = false;
let lastEndWasBomb = false;

let mpSocket = null;
let mpRoomId = "";
let mpClientId = "";
let isRoomHost = false;
let myPlayerName = "";
const playerStats = {};

const BACKGROUND_THEMES = ["bg-ocean", "bg-space", "bg-landscape"];

function mpConnected() {
  return mpSocket !== null && mpSocket.readyState === WebSocket.OPEN;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensurePlayer(id, name = "Player") {
  if (!id) return;
  if (!playerStats[id]) {
    playerStats[id] = { name, score: 0, treasure: 0 };
  } else if (name) {
    playerStats[id].name = name;
  }
}

function removePlayer(id) {
  if (playerStats[id]) {
    delete playerStats[id];
  }
}

function renderLeaderboard() {
  const entries = Object.entries(playerStats).sort((a, b) => b[1].score - a[1].score);
  const rows = entries
    .map(([id, p]) => {
      const me = id === mpClientId ? " (ban)" : "";
      return `<div class="leaderboard-item"><span>${p.name}${me}</span><strong>${p.score} | 💎 ${p.treasure}</strong></div>`;
    })
    .join("");
  leaderboard.innerHTML = `<h3>Bang diem phong</h3>${rows || "<div class='leaderboard-item'>Chua co nguoi choi</div>"}`;
}

function myStat() {
  return playerStats[mpClientId] || { score: 0, treasure: 0 };
}

function updateHud() {
  const me = myStat();
  scoreText.textContent = String(me.score);
  treasureText.textContent = String(me.treasure);
  targetText.textContent = currentTargetNumber === null ? "-" : String(currentTargetNumber);
  stateText.textContent = gameActive ? "Dang choi" : "Da dung";
  renderLeaderboard();
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
  if (finalTotal < total) {
    totalButtonsInput.value = String(finalTotal);
  }
  const grid = [];
  const offsetX = Math.max(padding, Math.floor((arenaWidth - cols * step + minGap) / 2));
  const offsetY = Math.max(padding, Math.floor((arenaHeight - rows * step + minGap) / 2));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      grid.push({ x: offsetX + c * step, y: offsetY + r * step });
    }
  }
  for (let i = grid.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [grid[i], grid[j]] = [grid[j], grid[i]];
  }
  return grid.slice(0, finalTotal);
}

function pickRoles(total, bombCount) {
  const picked = new Set();
  while (picked.size < bombCount) picked.add(randInt(0, total - 1));
  bombSet = picked;
  const maxTreasure = Math.max(1, Math.min(6, total - bombCount));
  const treasureCount = randInt(1, maxTreasure);
  const pickedTreasure = new Set();
  while (pickedTreasure.size < treasureCount) {
    const idx = randInt(0, total - 1);
    if (!bombSet.has(idx)) pickedTreasure.add(idx);
  }
  treasureSet = pickedTreasure;
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
  btn.classList.remove("safe", "treasure", "bomb");
  btn.classList.add("hidden");
  btn.dataset.revealed = "false";
  btn.dataset.role = role;
  btn.dataset.order = String(order);
  btn.innerHTML = `<span class="bubble-icon">🫧</span><span class="bubble-number">${order}</span>`;
}

function revealVisual(btn, role) {
  btn.classList.remove("hidden", "safe", "treasure", "bomb");
  if (role === "treasure") {
    btn.classList.add("treasure");
    btn.textContent = "💎";
  } else if (role === "bomb") {
    btn.classList.add("bomb");
    btn.textContent = "💣";
  } else {
    btn.classList.add("safe");
    btn.textContent = "OK";
  }
}

function pickNextTargetNumber() {
  const hidden = cells
    .filter((btn) => btn.dataset.revealed !== "true")
    .map((btn) => Number(btn.dataset.order))
    .filter((num) => Number.isFinite(num));
  if (hidden.length === 0) {
    currentTargetNumber = null;
    return false;
  }
  currentTargetNumber = hidden[randInt(0, hidden.length - 1)];
  return true;
}

function applyHostPermissions() {
  const hostCanEdit = isRoomHost;
  startBtn.disabled = !hostCanEdit;
  resetBtn.disabled = !hostCanEdit;
  totalButtonsInput.disabled = !hostCanEdit;
  bombCountInput.disabled = !hostCanEdit;
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
  const ended = !gameActive && overlay.classList.contains("show");
  sendRoomMsg(
    {
      kind: "full_state",
      gameActive,
      currentTargetNumber,
      theme: getThemeClass(),
      totalInput: totalButtonsInput.value,
      bombInput: bombCountInput.value,
      playerStats,
      ended,
      bombEnd: lastEndWasBomb,
      tiles
    },
    { excludeSelf: true }
  );
}

function applyFullState(payload) {
  applyingRemoteState = true;
  try {
    gameActive = Boolean(payload.gameActive);
    currentTargetNumber = payload.currentTargetNumber ?? null;
    totalButtonsInput.value = String(payload.totalInput ?? totalButtonsInput.value);
    bombCountInput.value = String(payload.bombInput ?? bombCountInput.value);
    Object.keys(playerStats).forEach((k) => delete playerStats[k]);
    Object.entries(payload.playerStats || {}).forEach(([k, v]) => {
      playerStats[k] = { name: v.name, score: v.score, treasure: v.treasure };
    });
    ensurePlayer(mpClientId, myPlayerName);
    document.body.classList.remove(...BACKGROUND_THEMES);
    document.body.classList.add(BACKGROUND_THEMES.includes(payload.theme) ? payload.theme : "bg-ocean");
    if (!payload.ended) overlay.classList.remove("show");
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
        revealVisual(btn, t.role);
      } else {
        setupHiddenTile(btn, t.order, t.role);
      }
      btn.addEventListener("click", () => handleTileClick(btn));
      cells.push(btn);
      arena.appendChild(btn);
    });
    updateHud();
    if (payload.ended) endGame(Boolean(payload.bombEnd), { silent: true });
  } finally {
    applyingRemoteState = false;
  }
}

function endGame(isBombClick, { silent = false } = {}) {
  gameActive = false;
  currentTargetNumber = null;
  lastEndWasBomb = isBombClick;
  updateHud();
  if (!silent) {
    // audio optional
  }
  resultTitle.textContent = isBombClick ? "Game Over" : "Ket thuc";
  resultText.innerHTML = isBombClick
    ? "Da bam vao BOOM."
    : "Ban da mo het cac o.";
  overlay.classList.add("show");
  messageText.textContent = isBombClick ? "Boom no! Cho host start lai." : "Van choi da ket thuc.";
  if (isRoomHost) broadcastFullState();
}

function updatePlayerScore(playerId, role) {
  ensurePlayer(playerId, playerId === mpClientId ? myPlayerName : "Player");
  if (role === "treasure") {
    playerStats[playerId].score += 10;
    playerStats[playerId].treasure += 1;
  } else if (role === "safe") {
    playerStats[playerId].score = Math.max(0, playerStats[playerId].score - 1);
  }
}

function handleTileClick(btn, actorId = mpClientId) {
  if (!gameActive) return;
  if (btn.dataset.revealed === "true") return;
  if (mpConnected() && !isRoomHost) {
    sendRoomMsg({ kind: "guest_click", order: Number(btn.dataset.order) }, { toHostOnly: true });
    return;
  }
  const clickedNumber = Number(btn.dataset.order);
  if (clickedNumber !== currentTargetNumber) {
    messageText.textContent = `Ban phai bam so ${currentTargetNumber}.`;
    return;
  }
  const role = btn.dataset.role;
  btn.dataset.revealed = "true";
  revealVisual(btn, role);
  if (role === "bomb") {
    endGame(true);
    return;
  }
  updatePlayerScore(actorId, role);
  if (role === "safe") {
    btn.classList.add("vanish");
    setTimeout(() => {
      if (btn.parentElement) {
        btn.remove();
        cells = cells.filter((c) => c !== btn);
      }
      if (isRoomHost) broadcastFullState();
    }, 540);
  }
  const hasNext = pickNextTargetNumber();
  updateHud();
  if (!hasNext) {
    endGame(false);
    return;
  }
  messageText.textContent = `So muc tieu tiep theo: ${currentTargetNumber}.`;
  if (isRoomHost) broadcastFullState();
}

function randomizeMap() {
  const { total, bombCount } = normalizeConfig();
  const positions = getRandomPositions(total);
  const realTotal = positions.length;
  const realBombCount = Math.min(bombCount, Math.max(1, realTotal - 1));
  const shuffledNumbers = createShuffledNumbers(realTotal);
  pickRoles(realTotal, realBombCount);
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
    else if (bombSet.has(i)) role = "bomb";
    setupHiddenTile(btn, shuffledNumbers[i], role);
    btn.addEventListener("click", () => handleTileClick(btn));
    cells.push(btn);
    arena.appendChild(btn);
  }
  pickNextTargetNumber();
  updateHud();
  messageText.textContent = `So muc tieu hien tai: ${currentTargetNumber}.`;
}

function startGame(resetPoint = false) {
  if (!isRoomHost) {
    messageText.textContent = "Chi chu phong moi duoc Start.";
    return;
  }
  if (resetPoint) {
    Object.keys(playerStats).forEach((id) => {
      playerStats[id].score = 0;
      playerStats[id].treasure = 0;
    });
  }
  gameActive = true;
  overlay.classList.remove("show");
  applyRandomBackground();
  syncTileSizeForScreen();
  randomizeMap();
  if (isRoomHost) broadcastFullState();
}

function connectMultiplayer() {
  const playerName = (playerNameInput.value || "").trim();
  if (!playerName) {
    messageText.textContent = "Hay nhap ten nguoi choi.";
    return;
  }
  const roomId = (roomIdInput.value || "").trim() || "room-1";
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
      mpRoomId = msg.roomId;
      mpClientId = msg.clientId;
      isRoomHost = Boolean(msg.isHost);
      Object.keys(playerStats).forEach((k) => delete playerStats[k]);
      (msg.peers || []).forEach((p) => ensurePlayer(p.id, p.name));
      ensurePlayer(mpClientId, myPlayerName);
      stepConnect.classList.add("hidden");
      stepGame.classList.remove("hidden");
      applyHostPermissions();
      mpStatusText.textContent = isRoomHost ? `Host · ${mpRoomId}` : `Khach · ${mpRoomId}`;
      messageText.textContent = isRoomHost
        ? "Ban la chu phong. Co the Start game va dat so nut."
        : "Da vao phong. Doi chu phong Start.";
      updateHud();
      if (!isRoomHost) sendRoomMsg({ kind: "need_state" }, { toHostOnly: true });
      return;
    }
    if (msg.type === "peer_joined" && msg.player) {
      ensurePlayer(msg.player.id, msg.player.name);
      updateHud();
      if (isRoomHost) broadcastFullState();
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
      messageText.textContent = "Host cu roi phong. Ban la host moi.";
      return;
    }
    if (msg.type === "room_msg" && msg.data) {
      const data = msg.data;
      if (data.kind === "full_state") {
        applyFullState(data);
      } else if (data.kind === "need_state" && isRoomHost) {
        broadcastFullState();
      } else if (data.kind === "guest_click" && isRoomHost) {
        const targetBtn = cells.find(
          (b) => Number(b.dataset.order) === Number(data.order) && b.dataset.revealed !== "true"
        );
        if (targetBtn) handleTileClick(targetBtn, msg.from);
      } else if (data.kind === "lobby") {
        messageText.textContent = "Da vao phong. Doi chu phong Start.";
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
