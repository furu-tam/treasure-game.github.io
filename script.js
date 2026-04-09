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

let score = 0;
let treasureFound = 0;
let gameActive = false;
let cells = [];
let treasureIndex = -1;
let bombSet = new Set();
let currentTargetNumber = null;
const BACKGROUND_THEMES = ["bg-ocean", "bg-space", "bg-landscape"];
let audioCtx = null;

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
  btn.classList.remove("hidden");
  btn.dataset.revealed = "true";

  if (role === "treasure") {
    btn.classList.add("treasure");
    btn.textContent = "💎";
    return role;
  }
  if (role === "bomb") {
    btn.classList.add("bomb");
    btn.textContent = "💣";
    return role;
  }

  btn.classList.add("safe");
  btn.textContent = "OK";
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

function endGame(isBombClick) {
  gameActive = false;
  currentTargetNumber = null;
  updateHud();
  playSfx(isBombClick ? "boom" : "safe");

  resultTitle.textContent = isBombClick ? "Game Over" : "Ket thuc";
  resultText.innerHTML = isBombClick
    ? `Ban vua bam vao <span class="danger">BOOM</span>.<br>Diem cuoi: <strong>${score}</strong>, kho bau: <strong>${treasureFound}</strong>.`
    : `Game da ket thuc.<br>Diem cuoi: <strong>${score}</strong>, kho bau: <strong>${treasureFound}</strong>.`;
  overlay.classList.add("show");
  messageText.textContent = isBombClick
    ? "Boom no! Bam Start de choi lai."
    : "Game ket thuc.";
}

function randomizeMap() {
  const { total, bombCount } = normalizeConfig();
  const positions = getRandomPositions(total);
  const realTotal = positions.length;
  const realBombCount = Math.min(bombCount, Math.max(1, realTotal - 1));
  const shuffledNumbers = createShuffledNumbers(realTotal);
  currentTargetNumber = null;
  pickRoles(realTotal, realBombCount);

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

    btn.addEventListener("click", () => {
      if (!gameActive) return;
      if (btn.dataset.revealed === "true") return;
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
        playSfx("treasure");
        score += 10;
        treasureFound += 1;
        messageText.textContent = "Chuc mung! Ban vua nhan duoc 1 kho bau.";
        updateHud();
      } else {
        playSfx("safe");
        score = Math.max(0, score - 1);
        messageText.textContent = "Khong co gi o day. Thu lai!";
        updateHud();
        btn.classList.add("vanish");
        setTimeout(() => {
          if (btn.parentElement) {
            btn.remove();
            cells = cells.filter((item) => item !== btn);
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
    });

    cells.push(btn);
    arena.appendChild(btn);
  }
  pickNextTargetNumber();
  updateHud();
  messageText.textContent = `So muc tieu hien tai: ${currentTargetNumber}.`;
}

function startGame(resetPoint = false) {
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
resetBtn.addEventListener("click", () => startGame(true));

window.addEventListener("resize", () => {
  syncTileSizeForScreen();
  if (!gameActive) return;
  randomizeMap();
});

updateHud();
applyRandomBackground();
syncTileSizeForScreen();
