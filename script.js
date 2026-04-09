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
const stateText = document.getElementById("stateText");
const messageText = document.getElementById("messageText");

let score = 0;
let treasureFound = 0;
let gameActive = false;
let cells = [];
let treasureIndex = -1;
let bombSet = new Set();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateHud() {
  scoreText.textContent = String(score);
  treasureText.textContent = String(treasureFound);
  stateText.textContent = gameActive ? "Dang choi" : "Da dung";
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
  const size = 54;
  const padding = 6;
  const maxX = Math.max(0, arena.clientWidth - size - padding);
  const maxY = Math.max(0, arena.clientHeight - size - padding);
  const positions = [];
  const used = new Set();

  for (let i = 0; i < total; i += 1) {
    let x = 0;
    let y = 0;
    let key = "";
    let guard = 0;

    do {
      x = randInt(padding, maxX);
      y = randInt(padding, maxY);
      key = `${Math.round(x / 8)}:${Math.round(y / 8)}`;
      guard += 1;
    } while (used.has(key) && guard < 2000);

    used.add(key);
    positions.push({ x, y });
  }
  return positions;
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

function styleTileByRole(btn, index) {
  btn.classList.remove("safe", "treasure", "bomb");
  btn.dataset.role = "safe";
  btn.textContent = "?";

  if (index === treasureIndex) {
    btn.classList.add("treasure");
    btn.dataset.role = "treasure";
    btn.textContent = "💎";
    return;
  }

  if (bombSet.has(index)) {
    btn.classList.add("bomb");
    btn.dataset.role = "bomb";
    btn.textContent = "💣";
    return;
  }

  btn.classList.add("safe");
}

function endGame(isBombClick) {
  gameActive = false;
  updateHud();

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
  pickRoles(total, bombCount);
  const positions = getRandomPositions(total);

  clearArenaButtons();
  cells = [];

  for (let i = 0; i < total; i += 1) {
    const btn = document.createElement("button");
    btn.className = "tile";
    btn.type = "button";
    btn.setAttribute("aria-label", `o-${i + 1}`);
    btn.style.left = `${positions[i].x}px`;
    btn.style.top = `${positions[i].y}px`;
    styleTileByRole(btn, i);

    btn.addEventListener("click", () => {
      if (!gameActive) return;

      const role = btn.dataset.role;
      if (role === "bomb") {
        endGame(true);
        return;
      }

      if (role === "treasure") {
        score += 10;
        treasureFound += 1;
        messageText.textContent = "Chuc mung! Ban vua tim thay kho bau.";
      } else {
        score = Math.max(0, score - 1);
        messageText.textContent = "Khong co gi o day. Thu lai!";
      }

      updateHud();
      randomizeMap();
    });

    cells.push(btn);
    arena.appendChild(btn);
  }
}

function startGame(resetPoint = false) {
  if (resetPoint) {
    score = 0;
    treasureFound = 0;
  }
  gameActive = true;
  overlay.classList.remove("show");
  updateHud();
  messageText.textContent = "Dang choi: tim kho bau va tranh boom.";
  randomizeMap();
}

startBtn.addEventListener("click", () => startGame(false));
playAgainBtn.addEventListener("click", () => startGame(false));
resetBtn.addEventListener("click", () => startGame(true));

window.addEventListener("resize", () => {
  if (!gameActive) return;
  randomizeMap();
});

updateHud();
