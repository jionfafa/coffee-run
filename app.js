// =====================
// Coffee Run - app.js (FULL)
// - 원본 UI(칩/샘플/셔플/모달/복사) 유지
// - 스프라이트 시트 애니메이션 유지
// - 회사→거리→카페 배경(도형/텍스트) + 회사 간판 "AUTO OVER"
// - 회사문 열리고 캐릭터 튀어나오는 출발 연출
// - 중반 역전 + 막판 극적 차이(커피=꼴찌 예정자 연출)
// - 슬로우 모션 + 화면 확대(줌) + 줌 고려 카메라 팔로우
// =====================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const UI = {
  nameInput: document.getElementById("nameInput"),
  addBtn: document.getElementById("addBtn"),
  chips: document.getElementById("chips"),
  sampleBtn: document.getElementById("sampleBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  start: document.getElementById("startBtn"),
  reset: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  leader: document.getElementById("leader"),
  meterFill: document.getElementById("meterFill"),

  modal: document.getElementById("modal"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  rerunBtn: document.getElementById("rerunBtn"),
  copyBtn: document.getElementById("copyBtn"),
  resultHeadline: document.getElementById("resultHeadline"),
  resultList: document.getElementById("resultList"),
};

const W = canvas.width, H = canvas.height;

const MAX_PLAYERS = 10;
const RACE_DIST = 100;
const PX_PER_M = 18;
const TRACK_START_X = 40;
const FINISH_X = TRACK_START_X + RACE_DIST * PX_PER_M;

const laneSpacing = 54;

// camera
let camX = 0;
let camZoom = 1.0;

function worldToScreenX(x) { return x - camX; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function smoothstep(t){
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// ===== Sprite Loader (runner1_sheet.png ~ runner5_sheet.png) =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패: " + src));
    img.src = src;
  });
}

const SHEET_FRAMES = 8;  // 프레임 수 고정
const spriteFiles = Array.from({ length: 5 }, (_, i) => `runner${i + 1}_sheet.png`);
let runnerSprites = [];

async function preloadSprites() {
  try {
    runnerSprites = await Promise.all(spriteFiles.map(loadImage));
    UI.status.textContent = "대기중 (스프라이트 시트 로드 ✅)";
  } catch (e) {
    console.warn(e);
    UI.status.textContent = "대기중 (시트 로드 실패: 파일명/경로 확인)";
  }
}
preloadSprites();

// 참가자 이름(칩)
let names = [];

let state = {
  running: false,
  t0: 0,
  runners: [],
  results: null,
  checkpoints: [20, 50, 80].map(m => TRACK_START_X + m * PX_PER_M),
  nextCpIdx: 0,

  // ✅ 연출용(커피=꼴찌)
  coffeeIdx: null,
  directorOn: true,

  // ✅ 출발 연출(문 열리고 튀어나옴)
  startAnimUntil: 0,
  startAnimDur: 900, // ms
};

// ===== Chips UI =====
function renderChips(){
  UI.chips.innerHTML = "";
  names.forEach((n, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${n}</span><small>#${i+1}</small>`;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "삭제";
    x.addEventListener("click", () => {
      names.splice(i, 1);
      renderChips();
      UI.status.textContent = `참가자 ${names.length}명`;
    });
    chip.appendChild(x);
    UI.chips.appendChild(chip);
  });
}

function addName(val){
  const n = (val ?? UI.nameInput.value).trim();
  if (!n) return;

  if (names.length >= MAX_PLAYERS){
    UI.status.textContent = "최대 10명까지!";
    return;
  }
  names.push(n);
  UI.nameInput.value = "";
  renderChips();
  UI.status.textContent = `참가자 ${names.length}명`;
}

function shuffleNames(){
  for (let i = names.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  renderChips();
  UI.status.textContent = "셔플 완료";
}

// ===== Race Model =====
function makeRunners(nameArr) {
  const n = clamp(nameArr.length, 1, MAX_PLAYERS);
  const topY = (H - (n - 1) * laneSpacing) / 2;

  const runners = [];
  for (let i = 0; i < n; i++) {
    const baseSpeed = 7.6 + Math.random() * 2.1; // 7.6~9.7
    runners.push({
      name: nameArr[i],
      lane: i,
      x: TRACK_START_X,
      y: topY + i * laneSpacing,
      baseSpeed,
      buff: 0,
      buffUntil: 0,
      finished: false,
      finishTime: null,
      spriteIndex: i % 10,

      // 출발 연출용
      spawnX: TRACK_START_X,
    });
  }
  return runners;
}

function triggerEvent(nowMs) {
  const events = [
    { label: "부장님 호출", delta: -1.8, dur: 1200 },
    { label: "커피 흡입", delta: +1.6, dur: 1100 },
    { label: "배탈",     delta: -2.3, dur: 800  },
    { label: "각성",     delta: +2.4, dur: 700  },
    { label: "회의 추가", delta: -1.2, dur: 900  },
  ];
  const alive = state.runners.filter(r => !r.finished);
  if (alive.length === 0) return;

  const r = alive[Math.floor(Math.random() * alive.length)];
  const e = events[Math.floor(Math.random() * events.length)];

  r.buff = e.delta;
  r.buffUntil = nowMs + e.dur;

  UI.status.textContent = `이벤트! ${r.name}: ${e.label}`;
}

function startRace() {
  if (names.length === 0) {
    UI.status.textContent = "이름을 최소 1명 추가!";
    return;
  }

  state.runners = makeRunners(names.slice(0, MAX_PLAYERS));
  state.running = true;
  state.results = null;
  state.nextCpIdx = 0;

  // ✅ 커피(꼴찌) 예정자 미리 고정
  state.coffeeIdx = Math.floor(Math.random() * state.runners.length);

  camX = 0;
  camZoom = 1.0;

  UI.meterFill.style.width = "0%";
  UI.leader.textContent = "현재 1등: -";
  UI.status.textContent = "READY... GO!";
  state.t0 = performance.now();

  // ✅ 출발 연출 시작(문 열리고 튀어나옴)
  state.startAnimUntil = state.t0 + state.startAnimDur;
  for (const r of state.runners) {
    r.spawnX = TRACK_START_X - 18; // 문 안쪽
    r.x = r.spawnX;
  }

  closeModal();
}

function reset() {
  state.running = false;
  state.runners = [];
  state.results = null;
  state.nextCpIdx = 0;
  state.coffeeIdx = null;

  state.startAnimUntil = 0;

  camX = 0;
  camZoom = 1.0;

  UI.meterFill.style.width = "0%";
  UI.leader.textContent = "현재 1등: -";
  UI.status.textContent = "대기중";
  closeModal();
}

function finishAndShowResults(){
  state.running = false;
  state.results = [...state.runners].sort((a, b) => a.finishTime - b.finishTime);

  const last = state.results[state.results.length - 1];
  UI.status.textContent = `종료! 커피는 ${last.name} ☕`;

  UI.resultHeadline.textContent = `☕ 오늘의 커피는 ${last.name}!`;
  UI.resultList.innerHTML = "";
  state.results.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row" + (idx === state.results.length - 1 ? " last" : "");
    row.innerHTML = `
      <div class="badge">${idx + 1}등</div>
      <div class="name">${r.name}</div>
      <div class="time">${r.finishTime.toFixed(2)}s</div>
    `;
    UI.resultList.appendChild(row);
  });

  openModal();
}

function update(dt, nowMs) {
  if (!state.running) return;

  // 진행률(선두 기준)
  const leaderX0 = Math.max(...state.runners.map(r => r.x));
  const p = clamp((leaderX0 - TRACK_START_X) / (FINISH_X - TRACK_START_X), 0, 1);

  // checkpoints(이벤트) - 출발 연출 중에는 이벤트 발생시키지 않음
  const inStartAnimGlobal = nowMs < state.startAnimUntil;
  if (!inStartAnimGlobal) {
    const nextCp = state.checkpoints[state.nextCpIdx];
    if (nextCp !== undefined) {
      if (leaderX0 >= nextCp) {
        triggerEvent(nowMs);
        state.nextCpIdx++;
      }
    }
  }

  // 연출 구간(진행률 기반)
  const MID_START = 0.35;
  const MID_END   = 0.70;
  const FINAL     = 0.90;

  // move
  for (const r of state.runners) {
    if (r.finished) continue;

    if (nowMs > r.buffUntil) r.buff = 0;

    // ✅ 출발 연출: 문 안쪽 → 밖으로 튀어나오기
    const inStartAnim = nowMs < state.startAnimUntil;
    if (inStartAnim) {
      const t = 1 - (state.startAnimUntil - nowMs) / state.startAnimDur; // 0..1
      const e = smoothstep(t);
      const burst = 42; // 튀어나오는 거리(px)
      r.x = r.spawnX + burst * e;
      continue;
    }

    // ✅ 연출 보정값(드라마)
    let directorBias = 0;
    if (state.directorOn && state.coffeeIdx != null) {
      const isCoffee = (r.lane === state.coffeeIdx);

      // 1) 중반: 커피 예정자는 잠깐 잘 달려서 "희망/역전" 느낌
      if (p >= MID_START && p < MID_END) {
        const t = smoothstep((p - MID_START) / (MID_END - MID_START));
        if (isCoffee) directorBias += 0.8 + 1.0 * t;
        else          directorBias += 0.15 + 0.25 * t;
      }

      // 2) 후반: 커피 예정자는 서서히 꺾이기 시작
      if (p >= MID_END && p < FINAL) {
        const t = smoothstep((p - MID_END) / (FINAL - MID_END));
        if (isCoffee) directorBias += 0.2 - 1.4 * t;
        else          directorBias += 0.1 - 0.2 * t;
      }

      // 3) 막판: 요동 + 마지막에 확 꺾이기(극적 차이)
      if (p >= FINAL) {
        const t = smoothstep((p - FINAL) / (1 - FINAL));
        const chaos = (Math.random() - 0.5) * 0.9;
        const nearFinish = p >= 0.97;
        if (isCoffee) directorBias += chaos + (nearFinish ? -2.2 : -0.6) * t;
        else          directorBias += chaos + (nearFinish ? +0.4 : +0.1) * t;
      }
    }

    const speedMps = clamp(r.baseSpeed + r.buff + directorBias, 2.8, 12.0);
    r.x += speedMps * PX_PER_M * dt;

    if (r.x >= FINISH_X) {
      r.x = FINISH_X;
      r.finished = true;
      r.finishTime = (nowMs - state.t0) / 1000;
    }
  }

  // ✅ 마지막 3% 안전장치: 커피 예정자가 너무 앞서면 살짝 당겨 사진판정 느낌 + 꼴찌 유지
  if (state.directorOn && state.coffeeIdx != null && p >= 0.97) {
    const coffee = state.runners[state.coffeeIdx];
    if (!coffee.finished) {
      coffee.x = Math.min(coffee.x, FINISH_X - 8 - Math.random() * 10);
    }
  }

  // leader 표시 (미완주 우선)
  const leader = state.runners
    .filter(r => !r.finished)
    .sort((a, b) => b.x - a.x)[0] || [...state.runners].sort((a, b) => b.x - a.x)[0];

  UI.leader.textContent = `현재 1등: ${leader?.name ?? "-"}`;

  // progress bar (leader-based)
  const pct = clamp(((leader.x - TRACK_START_X) / (FINISH_X - TRACK_START_X)) * 100, 0, 100);
  UI.meterFill.style.width = `${pct.toFixed(1)}%`;

  // camera follow leader (줌 고려)
  const viewW = W / camZoom;
  const targetCam = clamp((leader.x - viewW * 0.35), 0, FINISH_X - viewW + 40);
  camX += (targetCam - camX) * 0.08;

  // finish
  if (state.runners.every(r => r.finished)) {
    finishAndShowResults();
  }
}

// ===== Draw =====
function drawTrack(){
  // ===== 배경 기본 톤 =====
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ===== 구간 정의 (0~30m 회사 / 30~80m 거리 / 80~100m 카페) =====
  const officeEnd = TRACK_START_X + 30 * PX_PER_M;
  const streetEnd = TRACK_START_X + 80 * PX_PER_M;

  function segToScreen(x0, x1){
    const sx0 = worldToScreenX(x0);
    const sx1 = worldToScreenX(x1);
    return { sx0, sx1, w: sx1 - sx0 };
  }

  const segOffice = segToScreen(TRACK_START_X, officeEnd);
  const segStreet = segToScreen(officeEnd, streetEnd);
  const segCafe   = segToScreen(streetEnd, FINISH_X);

  // ===== 1) 회사 구간 (왼쪽) =====
  if (segOffice.w > 0) {
    // 하늘/배경
    ctx.fillStyle = "rgba(59,130,246,0.08)";
    ctx.fillRect(segOffice.sx0, 0, segOffice.w, H);

    // 건물
    const bW = Math.min(segOffice.w * 0.65, 260);
    const bH = 210;
    const bx = segOffice.sx0 + 18;
    const by = H - bH - 48;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(bx, by, bW, bH);

    // 회사 간판 (AUTO OVER)
    const signW = bW * 0.72;
    const signH = 28;
    const signX = bx + (bW - signW) / 2;
    const signY = by + 12;

    ctx.fillStyle = "rgba(0,0,0,0.60)";
    ctx.fillRect(signX, signY, signW, signH);

    ctx.fillStyle = "#22c55e";
    ctx.font = "bold 16px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AUTO OVER", signX + signW / 2, signY + signH / 2);

    // 네온 살짝
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 8;
    ctx.fillText("AUTO OVER", signX + signW / 2, signY + signH / 2);
    ctx.shadowBlur = 0;

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // 창문들
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    const cols = 6;
    const rows = 5;
    const pad = 10;
    const ww = (bW - pad * 2) / cols - 6;
    const wh = (bH - pad * 2) / rows - 10;
    for (let ry = 0; ry < rows; ry++){
      for (let cx = 0; cx < cols; cx++){
        const wx = bx + pad + cx * (ww + 6);
        const wy = by + pad + ry * (wh + 10) + 24; // 간판 아래로 조금 내림
        ctx.fillRect(wx, wy, ww, wh);
      }
    }

    // 문(열림 애니메이션)
    const doorW = bW * 0.16;
    const doorH = 40;
    const doorX = bx + bW * 0.42;
    const doorY = by + bH - doorH;

    let doorT = 0;
    if (state.running && state.startAnimUntil) {
      const now = performance.now();
      if (now < state.startAnimUntil) {
        doorT = 1 - (state.startAnimUntil - now) / state.startAnimDur;
        doorT = smoothstep(doorT);
      } else {
        doorT = 1;
      }
    }
    const gap = doorW * doorT;

    // 문짝
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(doorX, doorY, doorW * 0.5 - gap * 0.5, doorH);
    ctx.fillRect(doorX + doorW * 0.5 + gap * 0.5, doorY, doorW * 0.5 - gap * 0.5, doorH);

    // 안쪽(열린 공간)
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(doorX + doorW * 0.5 - gap * 0.5, doorY, gap, doorH);

    // 텍스트
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui";
    ctx.fillText("🏢 회사", segOffice.sx0 + 18, 26);

    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("출발!", segOffice.sx0 + 18, 44);
  }

  // ===== 2) 거리 구간 (중간) =====
  if (segStreet.w > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(segStreet.sx0, 0, segStreet.w, H);

    const roadY = H - 90;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(segStreet.sx0, roadY, segStreet.w, 70);

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(segStreet.sx0, roadY + 35);
    ctx.lineTo(segStreet.sx1, roadY + 35);
    ctx.stroke();
    ctx.setLineDash([]);

    const crossX = segStreet.sx0 + segStreet.w * 0.55;
    const crossW = 90;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < 6; i++){
      ctx.fillRect(crossX - crossW/2, roadY + 10 + i*9, crossW, 5);
    }

    ctx.font = "16px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("🚦", segStreet.sx0 + 18, 26);
    ctx.font = "14px system-ui";
    ctx.fillText("거리", segStreet.sx0 + 46, 26);
  }

  // ===== 3) 카페 구간 (오른쪽, 결승 포함) =====
  if (segCafe.w > 0) {
    ctx.fillStyle = "rgba(249,115,22,0.06)";
    ctx.fillRect(segCafe.sx0, 0, segCafe.w, H);

    const cW = Math.min(segCafe.w * 0.75, 300);
    const cH = 190;
    const cx = segCafe.sx1 - cW - 18;
    const cy = H - cH - 48;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(cx, cy, cW, cH);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx + 18, cy + 18, cW - 36, 40);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "18px system-ui";
    ctx.fillText("☕ COFFEE", cx + 30, cy + 46);

    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(cx + 22, cy + 70, cW * 0.32, 44);
    ctx.fillRect(cx + 22 + cW * 0.36, cy + 70, cW * 0.32, 44);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx + cW * 0.78, cy + cH - 52, cW * 0.14, 52);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui";
    ctx.fillText("☕ 카페", segCafe.sx0 + 18, 26);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("목적지!", segCafe.sx0 + 18, 44);
  }

  // ===== 레인 라인 =====
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  for (const r of state.runners) {
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(TRACK_START_X), r.y + 18);
    ctx.lineTo(worldToScreenX(FINISH_X), r.y + 18);
    ctx.stroke();
  }

  // ===== 거리 마커(0/50/100m) =====
  const markers = [0, 50, 100].map(m => TRACK_START_X + m * PX_PER_M);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "12px system-ui";
  markers.forEach((mx, i) => {
    const sx = worldToScreenX(mx);
    ctx.fillRect(sx, 0, 1, H);
    const label = i === 0 ? "0m" : (i === 1 ? "50m" : "100m");
    ctx.fillText(label, sx + 4, 16);
  });

  // ===== 결승선 =====
  const fx = worldToScreenX(FINISH_X);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(fx, 0, 3, H);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "14px system-ui";
  ctx.fillText("🏁", fx - 22, 28);
}

function drawRunners(){
  for (const r of state.runners) {
    const sx = worldToScreenX(r.x);

    // 이름
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui";
    ctx.fillText(r.name, sx - 10, r.y - 6);

    const img = runnerSprites.length ? runnerSprites[r.spriteIndex % runnerSprites.length] : null;

    // 화면에 그릴 크기
    const size = 52;
    const drawX = sx - size / 2;
    const drawY = r.y + 2;

    if (img) {
      // 속도 기반 애니메이션 fps (출발 연출 중엔 고정)
      const inStartAnim = state.running && performance.now() < state.startAnimUntil;
      const speedMps = clamp(r.baseSpeed + r.buff, 2.8, 8.0);
      const fps = inStartAnim ? 9 : (8 + speedMps);

      const t = performance.now() / 1000;
      const frame = r.finished ? 0 : (Math.floor(t * fps) % SHEET_FRAMES);

      const sw = Math.floor(img.width / SHEET_FRAMES);
      const sh = img.height;

      // 바운스(출발 연출 중 더 강하게)
      const bobAmp = inStartAnim ? 3.0 : 2.0;
      const bob = r.finished ? 0 : Math.sin(t * fps * 0.55 + r.lane) * bobAmp;

      ctx.globalAlpha = r.finished ? 0.45 : 1.0;

      ctx.drawImage(
        img,
        frame * sw, 0, sw, sh,
        drawX, drawY + bob, size, size
      );

      ctx.globalAlpha = 1.0;
    } else {
      ctx.beginPath();
      ctx.arc(sx, r.y + 18, 12, 0, Math.PI * 2);
      ctx.fillStyle = r.finished ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)";
      ctx.fill();
    }

    // 버프 아이콘
    if (!r.finished && r.buff !== 0 && performance.now() >= state.startAnimUntil) {
      ctx.fillStyle = r.buff > 0 ? "rgba(34,197,94,0.9)" : "rgba(249,115,22,0.9)";
      ctx.font = "14px system-ui";
      ctx.fillText(r.buff > 0 ? "⚡" : "💥", sx + 26, r.y + 18);
    }
  }
}

function draw(){
  // reset transform + clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // zoom transform
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(camZoom, camZoom);
  ctx.translate(-W / 2, -H / 2);

  drawTrack();
  drawRunners();

  // 출발 오버레이
  if (state.running && performance.now() < state.startAnimUntil) {
    const t = 1 - (state.startAnimUntil - performance.now()) / state.startAnimDur;
    const a = 1 - smoothstep(t);
    ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
    ctx.font = "bold 22px system-ui";
    ctx.fillText("AUTO OVER 본사 출발!", 18, 64);
  }

  if (state.running) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "12px system-ui";
    ctx.fillText("선두 기준 화면 이동 중…", 12, H - 14);
  }

  ctx.restore();
}

// ===== Loop (slow motion + zoom) =====
let last = performance.now();
function loop(now){
  let dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  // ✅ 슬로우 모션 + 줌(결승 근처)
  if (state.running && state.runners.length){
    const leaderX = Math.max(...state.runners.map(r => r.x));
    const p = clamp((leaderX - TRACK_START_X) / (FINISH_X - TRACK_START_X), 0, 1);

    // 90%부터 느려지기 시작 → 97%쯤 가장 느림
    const t = smoothstep((p - 0.90) / 0.07);
    const slow = lerp(1.0, 0.35, t);
    dt *= slow;

    // 92%부터 줌 → 막판 최대 1.35배
    const zt = smoothstep((p - 0.92) / 0.08);
    camZoom = lerp(1.0, 1.35, zt);
  } else {
    camZoom = lerp(camZoom, 1.0, 0.12);
  }

  update(dt, now);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===== Modal =====
function openModal(){ UI.modal.classList.remove("hidden"); }
function closeModal(){ UI.modal.classList.add("hidden"); }

// ===== Events =====
UI.addBtn.addEventListener("click", () => addName());
UI.nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addName();
});

UI.sampleBtn.addEventListener("click", () => {
  names = ["준혁","민수","지은","영희","철수","수진"];
  renderChips();
  UI.status.textContent = "샘플 입력 완료";
});

UI.shuffleBtn.addEventListener("click", shuffleNames);

UI.start.addEventListener("click", startRace);
UI.reset.addEventListener("click", reset);

UI.closeModalBtn.addEventListener("click", closeModal);
UI.modal.addEventListener("click", (e) => {
  if (e.target === UI.modal) closeModal();
});
UI.rerunBtn.addEventListener("click", startRace);

UI.copyBtn.addEventListener("click", async () => {
  if (!state.results) return;
  const last = state.results[state.results.length - 1];
  const lines = [
    `커피런 100m 결과`,
    `커피: ${last.name}`,
    ...state.results.map((r, i) => `${i+1}등 ${r.name} (${r.finishTime.toFixed(2)}s)`)
  ];
  try{
    await navigator.clipboard.writeText(lines.join("\n"));
    UI.status.textContent = "결과 복사 완료!";
  }catch{
    UI.status.textContent = "복사 실패(브라우저 권한 확인)";
  }
});

// init
renderChips();
UI.status.textContent = "대기중";
