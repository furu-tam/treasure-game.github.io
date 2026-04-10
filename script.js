const arena = document.getElementById("arena");
const overlay = document.getElementById("overlay");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const playAgainBtn = document.getElementById("playAgainBtn");

const totalButtonsInput = document.getElementById("totalButtonsInput");
const bombCountInput = document.getElementById("bombCountInput");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");

const scoreText = document.getElementById("scoreText");
const treasureText = document.getElementById("treasureText");
const targetText = document.getElementById("targetText");
const stateText = document.getElementById("stateText");
const messageText = document.getElementById("messageText");

const mpEnabledInput = document.getElementById("mpEnabledInput");
const wsUrlInput = document.getElementById("wsUrlInput");
const roomIdInput = document.getElementById("roomIdInput");
const mpConnectBtn = document.getElementById("mpConnectBtn");
const mpStatusText = document.getElementById("mpStatusText");

let score = 0;
let treasureFound = 0;
let gameActive = false;
let cells = [];
let treasureIndex = -1;
let bombSet = new Set();
let currentTargetNumber = null;
let lastEndWasBomb = false;
let hostArenaWidth = 1;
let hostArenaHeight = 1;

const BACKGROUND_THEMES = ["bg-ocean", "bg-space", "bg-landscape"];
let audioCtx = null;

/** @type {WebSocket | null} */
let mpSocket = null;
let mpRoomId = "";
let mpClientId = "";
let isRoomHost = false;
let applyingRemoteState = false;

function mpConnected() {
  return mpSocket !== null && mpSocket.readyState === WebSocket.OPEN;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateHud() {
  scoreText.textContent = String(score);
  treasureText.textContent = String(treasureFound);
  targetText.textContent = currentTargetNumber === null ? "-" : String(currentTargetNumber);
  stateText.textContent = gameActive ? "Dang choi" : "Da dung";
}

function applyRandomBackground() {
  document.body.classList.remove(...BACKGROUND_THEMES);
  const theme = BACKGROUND_THEMES[randInt(0, BACKGROUND_THEMES.length - 1)];
  document.body.classList.add(theme);
}

function syncTileSizeForScreen() {
  const base = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(56, Math.min(94, Math.round(base * 0.09)));
  document.documentElement.style.setProperty("--btn-size", `${size}px`);
}

function getTileSize() {
  const sizeRaw = getComputedStyle(document.documentElement).getPropertyValue("--btn-size");
  const parsed = Number.parseFloat(sizeRaw);
  return Number.isFinite(parsed) ? parsed : 64;
}

function ensureAudioContext() {
  if (!audioCtx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) {
      audioCtx = new Context();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playTone(frequency, duration = 0.15, type = "sine", gainValue = 0.04) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playSfx(type) {
  ensureAudioContext();
  if (!audioCtx) return;
  if (type === "safe") {
    playTone(280, 0.08, "triangle", 0.03);
    return;
  }
  if (type === "treasure") {
    playTone(560, 0.12, "triangle", 0.05);
    setTimeout(() => playTone(760, 0.16, "triangle", 0.045), 80);
    return;
  }
  if (type === "boom") {
    playTone(120, 0.2, "sawtooth", 0.06);
    setTimeout(() => playTone(80, 0.25, "square", 0.05), 40);
    return;
  }
  if (type === "start") {
    playTone(360, 0.08, "sine", 0.03);
    setTimeout(() => playTone(480, 0.08, "sine", 0.03), 70);
  }
}

function disconnectMultiplayer() {
  if (mpSocket) {
    mpSocket.close();
    mpSocket = null;
  }
  mpRoomId = "";
  mpClientId = "";
  isRoomHost = false;
  mpStatusText.textContent = "Offline";
}

function sendRoomMsg(data, { excludeSelf = false, toHostOnly = false } = {}) {
  if (!mpConnected()) return;
  mpSocket.send(JSON.stringify({ type: "room_msg", data, excludeSelf, toHostOnly }));
}

function getCurrentThemeClass() {
  if (document.body.classList.contains("bg-ocean")) return "bg-ocean";
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
      score,
      treasureFound,
      gameActive,
      currentTargetNumber,
      theme: getCurrentThemeClass(),
      totalInput: totalButtonsInput.value,
      bombInput: bombCountInput.value,
      ended,
      bombEnd: lastEndWasBomb,
      hostArenaW: w,
      hostArenaH: h,
      tiles
    },
    { excludeSelf: true }
  );
}

function revealVisual(btn, role) {
  btn.classList.remove("hidden", "safe", "treasure", "bomb");
  if (role === "treasure") {
    btn.classList.add("treasure");
    btn.textContent = "💎";
    return;
  }
  if (role === "bomb") {
    btn.classList.add("bomb");
    btn.textContent = "💣";
    return;
  }
  btn.classList.add("safe");
  btn.textContent = "OK";
}

function setupHiddenTile(btn, order, role) {
  btn.classList.remove("safe", "treasure", "bomb");
  btn.classList.add("hidden");
  btn.dataset.revealed = "false";
  btn.dataset.role = role;
  btn.dataset.order = String(order);
  btn.textContent = String(order);
}

function applyFullState(payload) {
  applyingRemoteState = true;
  try {
    score = payload.score;
    treasureFound = payload.treasureFound;
    gameActive = payload.gameActive;
    currentTargetNumber =
      payload.currentTargetNumber === null || payload.currentTargetNumber === undefined
        ? null
        : payload.currentTargetNumber;

    totalButtonsInput.value = String(payload.totalInput ?? totalButtonsInput.value);
    bombCountInput.value = String(payload.bombInput ?? bombCountInput.value);

    document.body.classList.remove(...BACKGROUND_THEMES);
    const theme = BACKGROUND_THEMES.includes(payload.theme) ? payload.theme : "bg-ocean";
    document.body.classList.add(theme);

    if (!payload.ended) {
      overlay.classList.remove("show");
    }

    clearArenaButtons();
    cells = [];
    treasureIndex = -1;
    bombSet.clear();

    const aw = Math.max(1, arena.clientWidth);
    const ah = Math.max(1, arena.clientHeight);

    payload.tiles.forEach((t, idx) => {
      const btn = document.createElement("button");
      btn.className = "tile";
      btn.type = "button";
      btn.setAttribute("aria-label", `o-${idx + 1}`);
      btn.style.left = `${(t.nx ?? 0) * aw}px`;
      btn.style.top = `${(t.ny ?? 0) * ah}px`;

      const role = t.role === "treasure" || t.role === "bomb" ? t.role : "safe";
      if (t.revealed) {
        btn.dataset.revealed = "true";
        btn.dataset.role = role;
        btn.dataset.order = String(t.order);
        revealVisual(btn, role);
      } else {
        setupHiddenTile(btn, t.order, role);
      }

      btn.addEventListener("click", () => handleTileClick(btn));
      cells.push(btn);
      arena.appendChild(btn);
    });

    updateHud();

    if (payload.ended) {
      endGame(Boolean(payload.bombEnd), { silent: true });
    }
  } finally {
    applyingRemoteState = false;
  }
}

function handleIncomingRoomData(data) {
  if (data.kind === "full_state") {
    applyFullState(data);
    return;
  }
  if (data.kind === "lobby") {
    messageText.textContent = "Da vao phong. Doi host bat dau (Start).";
    return;
  }
  if (data.kind === "guest_click" && isRoomHost) {
    const order = Number(data.order);
    const btn = cells.find(
      (b) => Number(b.dataset.order) === order && b.dataset.revealed !== "true"
    );
    if (btn) {
      handleTileClick(btn, { fromPeer: true });
    }
    return;
  }
  if (data.kind === "need_state" && isRoomHost) {
    if (gameActive || cells.length > 0) {
      broadcastFullState();
    } else {
      sendRoomMsg({ kind: "lobby" }, { excludeSelf: true });
    }
    return;
  }
}

function connectMultiplayer() {
  if (!mpEnabledInput.checked) {
    messageText.textContent = "Hay bat Multiplayer truoc khi ket noi.";
    return;
  }
  const url = (wsUrlInput.value || "").trim() || "ws://localhost:8080";
  const rid = (roomIdInput.value || "").trim() || "default";
  disconnectMultiplayer();
  mpStatusText.textContent = "Dang ket noi...";

  const socket = new WebSocket(url);
  mpSocket = socket;

  socket.addEventListener("open", () => {
    mpRoomId = rid;
    socket.send(JSON.stringify({ type: "join", roomId: rid }));
  });

  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    if (msg.type === "joined") {
      mpRoomId = msg.roomId || mpRoomId;
      mpClientId = msg.clientId || "";
      isRoomHost = Boolean(msg.isHost);
      mpStatusText.textContent = isRoomHost ? `Host · ${mpRoomId}` : `Khach · ${mpRoomId}`;
      if (!isRoomHost) {
        sendRoomMsg({ kind: "need_state" }, { toHostOnly: true });
      }
      return;
    }

    if (msg.type === "promoted_host") {
      isRoomHost = true;
      mpStatusText.textContent = `Host · ${mpRoomId}`;
      messageText.textContent = "Ban tro thanh host. Bam Start de bat dau van moi.";
      return;
    }

    if (msg.type === "room_msg" && msg.data) {
      handleIncomingRoomData(msg.data);
    }
  });

  socket.addEventListener("close", () => {
    mpStatusText.textContent = "Offline";
    mpSocket = null;
    mpRoomId = "";
    mpClientId = "";
    isRoomHost = false;
  });

  socket.addEventListener("error", () => {
    mpStatusText.textContent = "Loi ket noi";
  });
}

function clearArenaButtons() {
  const oldButtons = arena.querySelectorAll(".tile");
  oldButtons.forEach((btn) => btn.remove());
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
  const availableArea = Math.max(1, (arenaWidth - padding * 2) * (arenaHeight - padding * 2));
  const estimatedSize = Math.floor(Math.sqrt(availableArea / Math.max(1, total)) - minGap);
  if (estimatedSize > 0 && total > 36) {
    size = Math.max(38, Math.min(size, estimatedSize));
    document.documentElement.style.setProperty("--btn-size", `${size}px`);
  }

  const step = size + minGap;
  const cols = Math.max(1, Math.floor((arenaWidth - padding * 2 + minGap) / step));
  const rows = Math.max(1, Math.floor((arenaHeight - padding * 2 + minGap) / step));
  const capacity = cols * rows;
  const finalTotal = Math.min(total, capacity);

  if (finalTotal < total) {
    totalButtonsInput.value = String(finalTotal);
    messageText.textContent = `Man hinh hien tai chi hien thi toi da ${finalTotal} nut khong chong len nhau.`;
  }

  const gridPositions = [];
  const offsetX = Math.max(padding, Math.floor((arenaWidth - cols * step + minGap) / 2));
  const offsetY = Math.max(padding, Math.floor((arenaHeight - rows * step + minGap) / 2));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      gridPositions.push({
        x: offsetX + col * step,
        y: offsetY + row * step
      });
    }
  }

  for (let i = gridPositions.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [gridPositions[i], gridPositions[j]] = [gridPositions[j], gridPositions[i]];
  }

  return gridPositions.slice(0, finalTotal);
}

function pickRoles(total, bombCount) {
  const picked = new Set();
  while (picked.size < bombCount) {
    picked.add(randInt(0, total - 1));
  }
  bombSet = picked;

  do {
    treasureIndex = randInt(0, total - 1);
  } while (bombSet.has(treasureIndex));
}

function createShuffledNumbers(total) {
  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function assignRole(btn, index, orderNumber) {
  btn.classList.remove("safe", "treasure", "bomb");
  btn.classList.add("hidden");
  btn.dataset.revealed = "false";
  btn.dataset.role = "safe";
  btn.dataset.order = String(orderNumber);
  btn.textContent = String(orderNumber);

  if (index === treasureIndex) {
    btn.dataset.role = "treasure";
    return;
  }
  if (bombSet.has(index)) {
    btn.dataset.role = "bomb";
  }
}

function revealTile(btn) {
  const role = btn.dataset.role;
  btn.dataset.revealed = "true";
  btn.classList.remove("hidden");
  revealVisual(btn, role);
  return role;
}

function pickNextTargetNumber() {
  const unrevealedNumbers = cells
    .filter((btn) => btn.dataset.revealed !== "true")
    .map((btn) => Number(btn.dataset.order))
    .filter((num) => Number.isFinite(num));

  if (unrevealedNumbers.length === 0) {
    currentTargetNumber = null;
    return false;
  }

  const randomIndex = randInt(0, unrevealedNumbers.length - 1);
  currentTargetNumber = unrevealedNumbers[randomIndex];
  return true;
}

function endGame(isBombClick, { silent = false } = {}) {
  gameActive = false;
  currentTargetNumber = null;
  lastEndWasBomb = isBombClick;
  updateHud();
  if (!silent) {
    playSfx(isBombClick ? "boom" : "safe");
  }

  resultTitle.textContent = isBombClick ? "Game Over" : "Ket thuc";
  resultText.innerHTML = isBombClick
    ? `Ban vua bam vao <span class="danger">BOOM</span>.<br>Diem cuoi: <strong>${score}</strong>, kho bau: <strong>${treasureFound}</strong>.`
    : `Game da ket thuc.<br>Diem cuoi: <strong>${score}</strong>, kho bau: <strong>${treasureFound}</strong>.`;
  overlay.classList.add("show");
  messageText.textContent = isBombClick
    ? "Boom no! Bam Start de choi lai."
    : "Game ket thuc.";

  if (mpConnected() && isRoomHost && !applyingRemoteState) {
    broadcastFullState();
  }
}

function handleTileClick(btn, { fromPeer = false } = {}) {
  if (!gameActive) return;
  if (btn.dataset.revealed === "true") return;

  if (mpConnected() && !isRoomHost && !fromPeer) {
    sendRoomMsg({ kind: "guest_click", order: Number(btn.dataset.order) }, { toHostOnly: true });
    return;
  }

  const clickedNumber = Number(btn.dataset.order);
  if (clickedNumber !== currentTargetNumber) {
    messageText.textContent = `Ban phai bam dung so muc tieu: ${currentTargetNumber}.`;
    return;
  }

  const role = revealTile(btn);
  if (role === "bomb") {
    endGame(true);
    return;
  }

  if (role === "treasure") {
    if (!fromPeer) {
      playSfx("treasure");
    }
    score += 10;
    treasureFound += 1;
    messageText.textContent = "Chuc mung! Ban vua nhan duoc 1 kho bau.";
    updateHud();
  } else {
    if (!fromPeer) {
      playSfx("safe");
    }
    score = Math.max(0, score - 1);
    messageText.textContent = "Khong co gi o day. Thu lai!";
    updateHud();
    btn.classList.add("vanish");
    setTimeout(() => {
      if (btn.parentElement) {
        btn.remove();
        cells = cells.filter((item) => item !== btn);
      }
      if (mpConnected() && isRoomHost) {
        broadcastFullState();
      }
    }, 540);
  }

  const hasNext = pickNextTargetNumber();
  updateHud();
  if (!hasNext) {
    endGame(false);
    return;
  }
  messageText.textContent = `So muc tieu tiep theo: ${currentTargetNumber}.`;

  if (mpConnected() && isRoomHost) {
    broadcastFullState();
  }
}

function randomizeMap() {
  const { total, bombCount } = normalizeConfig();
  const positions = getRandomPositions(total);
  const realTotal = positions.length;
  const realBombCount = Math.min(bombCount, Math.max(1, realTotal - 1));
  const shuffledNumbers = createShuffledNumbers(realTotal);
  currentTargetNumber = null;
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
    assignRole(btn, i, shuffledNumbers[i]);

    btn.addEventListener("click", () => handleTileClick(btn));

    cells.push(btn);
    arena.appendChild(btn);
  }
  pickNextTargetNumber();
  updateHud();
  messageText.textContent = `So muc tieu hien tai: ${currentTargetNumber}.`;

  if (mpConnected() && isRoomHost) {
    broadcastFullState();
  }
}

function startGame(resetPoint = false) {
  if (mpConnected() && !isRoomHost) {
    messageText.textContent = "Ban la khach: chi host duoc bat dau van (Start).";
    return;
  }

  if (resetPoint) {
    score = 0;
    treasureFound = 0;
  }
  gameActive = true;
  overlay.classList.remove("show");
  updateHud();
  applyRandomBackground();
  syncTileSizeForScreen();
  playSfx("start");
  randomizeMap();
}

startBtn.addEventListener("click", () => startGame(false));
playAgainBtn.addEventListener("click", () => startGame(false));
resetBtn.addEventListener("click", () => {
  if (mpConnected() && !isRoomHost) {
    messageText.textContent = "Chi host duoc reset diem.";
    return;
  }
  startGame(true);
});

mpConnectBtn.addEventListener("click", () => {
  connectMultiplayer();
});

window.addEventListener("resize", () => {
  syncTileSizeForScreen();
  if (mpConnected() && gameActive) {
    return;
  }
  if (!gameActive) return;
  randomizeMap();
});

updateHud();
applyRandomBackground();
syncTileSizeForScreen();
