// =====================
// Coffee Run - app.js (FULL)
//
// 포함 기능
// - 참가자 칩 UI(추가/삭제/샘플/셔플)
// - 100m 레이스 + 결과 모달(복사/재경기)
// - 스프라이트 시트 러너(8프레임) 로드
// - 회사 → 거리 → 카페 배경 + 회사 간판 "AUTO OVER"
// - 출발: 회사문 열리고 캐릭터 튀어나오는 연출
// - 꼴찌(커피) 연출: 막판 '신발끈이 풀렸네!' 말풍선 + 1.5초 정지 후 완주
// - ? 결승 동률(같은 프레임) 꼴찌 판정 흔들림 방지(보간 + finishOrder)
// - ? 전체 완주 15초 내 목표(기본 속도/슬로우모션 완화/속도 하한 상향)
// - ? 카메라: 선두를 따라가되, 골인 순서대로 잠깐씩 포커스 이동
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

const W = canvas.width,
  H = canvas.height;

const MAX_PLAYERS = 10;
const RACE_DIST = 100;
const PX_PER_M = 18;
const TRACK_START_X = 40;
const FINISH_X = TRACK_START_X + RACE_DIST * PX_PER_M;

const laneSpacing = 54;

// camera
let camX = 0;
let camZoom = 1.0;

function worldToScreenX(x) {
  return x - camX;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// ===== Sprite Loader (runner1_sheet.png ~ runner10_sheet.png) =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패: " + src));
    img.src = src;
  });
}

const SHEET_FRAMES = 8; // 프레임 수 고정
const spriteFiles = Array.from({ length: 10 }, (_, i) => `runner${i + 1}_sheet.png`);
let runnerSprites = [];

async function preloadSprites() {
  try {
    runnerSprites = await Promise.all(spriteFiles.map(loadImage));
    UI.status.textContent = "대기중 (스프라이트 시트 로드 ?)";
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

  // ? 동률(같은 프레임) 결승 처리 시 순서가 흔들리는 문제 방지용
  finishSeq: 0,

  checkpoints: [20, 50, 80].map((m) => TRACK_START_X + m * PX_PER_M),
  nextCpIdx: 0,

  // ? 연출용(커피=꼴찌)
  coffeeIdx: null,
  directorOn: true,

  // ? 출발 연출(문 열리고 튀어나옴)
  startAnimUntil: 0,
  startAnimDur: 900, // ms

  // ? 결승선 들어오는 순서대로 카메라 포커스
  focusRunnerIdx: null,
  focusUntilMs: 0,
  focusHoldMs: 850, // ms

  // ? 마지막 3% 연출: 신발끈 이벤트(말풍선 + 잠깐 정지)
  laceEventTriggered: false,
  laceRunnerIdx: null,
  laceStartMs: 0,
  laceDuration: 1500, // ms
  laceText: "아!신발끈!",
};

// ===== Chips UI =====
function renderChips() {
  UI.chips.innerHTML = "";
  names.forEach((n, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${n}</span><small>#${i + 1}</small>`;
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

function addName(val) {
  const n = (val ?? UI.nameInput.value).trim();
  if (!n) return;

  if (names.length >= MAX_PLAYERS) {
    UI.status.textContent = "최대 10명까지!";
    return;
  }
  names.push(n);
  UI.nameInput.value = "";
  renderChips();
  UI.status.textContent = `참가자 ${names.length}명`;
}

function shuffleNames() {
  for (let i = names.length - 1; i > 0; i--) {
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
    // ? 15초 내 완주를 위해 기본 속도 상향
    const baseSpeed = 8.6 + Math.random() * 1.4; // 8.6~11.0 m/s
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
      finishOrder: null,
      spriteIndex: i % 10,

      // 출발 연출용
      spawnX: TRACK_START_X,

      // ? 신발끈 이벤트(멈춤) 상태
      laceStopped: false,
      laceEndMs: 0,
    });
  }
  return runners;
}

function triggerEvent(nowMs) {
  const events = [
    { label: "부장님 호출", delta: -1.8, dur: 1200 },
    { label: "커피 흡입", delta: +1.6, dur: 1100 },
    { label: "배탈", delta: -2.3, dur: 800 },
    { label: "각성", delta: +2.4, dur: 700 },
    { label: "회의 추가", delta: -1.2, dur: 900 },
  ];
  const alive = state.runners.filter((r) => !r.finished);
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
  state.finishSeq = 0;

  // ? 커피(꼴찌) 예정자 미리 고정
  state.coffeeIdx = Math.floor(Math.random() * state.runners.length);

  // ? 포커스/신발끈 연출 초기화
  state.focusRunnerIdx = null;
  state.focusUntilMs = 0;
  state.laceEventTriggered = false;
  state.laceRunnerIdx = null;
  state.laceStartMs = 0;
  for (const rr of state.runners) {
    rr.laceStopped = false;
    rr.laceEndMs = 0;
  }

  camX = 0;
  camZoom = 1.0;

  UI.meterFill.style.width = "0%";
  UI.leader.textContent = "현재 1등: -";
  UI.status.textContent = "READY... GO!";
  state.t0 = performance.now();

  // ? 출발 연출 시작(문 안쪽에서 튀어나옴)
  state.startAnimUntil = state.t0 + state.startAnimDur;
  for (const r of state.runners) {
    r.spawnX = TRACK_START_X - 18;
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
  state.finishSeq = 0;

  state.startAnimUntil = 0;

  state.focusRunnerIdx = null;
  state.focusUntilMs = 0;
  state.laceEventTriggered = false;
  state.laceRunnerIdx = null;
  state.laceStartMs = 0;

  camX = 0;
  camZoom = 1.0;

  UI.meterFill.style.width = "0%";
  UI.leader.textContent = "현재 1등: -";
  UI.status.textContent = "대기중";
  closeModal();
}

function finishAndShowResults() {
  state.running = false;

  // ? finishTime 동률 시 finishOrder로 타이브레이커
  state.results = [...state.runners].sort((a, b) => {
    const t = a.finishTime - b.finishTime;
    if (t !== 0) return t;
    return (a.finishOrder ?? 0) - (b.finishOrder ?? 0);
  });

  const last = state.results[state.results.length - 1];
  UI.status.textContent = `종료! 커피는 ${last.name} ?`;

  UI.resultHeadline.textContent = `? 오늘의 커피는 ${last.name}!`;
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
  const leaderX0 = Math.max(...state.runners.map((r) => r.x));
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

  // ==========================
  // ? 마지막 3% 신발끈 이벤트 (꼴찌 연출 + 완주 보장)
  // - 커피 예정자가 97% 이상 도달했을 때 1회 발동
  // - 다른 주자들이 아직 완주 전일 때만 발동
  // ==========================
  if (state.directorOn && !inStartAnimGlobal && !state.laceEventTriggered && state.coffeeIdx != null) {
    const coffee = state.runners[state.coffeeIdx];
    if (coffee && !coffee.finished) {
      const coffeeProgress = clamp((coffee.x - TRACK_START_X) / (FINISH_X - TRACK_START_X), 0, 1);
      const othersAllFinished = state.runners.every((rr, idx) => idx === state.coffeeIdx || rr.finished);
      if (!othersAllFinished && coffeeProgress >= 0.97) {
        state.laceEventTriggered = true;
        state.laceRunnerIdx = state.coffeeIdx;
        state.laceStartMs = nowMs;

        coffee.laceStopped = true;
        coffee.laceEndMs = nowMs + state.laceDuration;
        coffee.x = Math.min(coffee.x, FINISH_X - 8);
        UI.status.textContent = `이벤트! ${coffee.name}: ${state.laceText}`;
      }
    }
  }

  // 연출 구간(진행률 기반)
  const MID_START = 0.35;
  const MID_END = 0.70;
  const FINAL = 0.90;

  // move
  for (const r of state.runners) {
    if (r.finished) continue;
    if (nowMs > r.buffUntil) r.buff = 0;

    // ? 출발 연출: 문 안쪽 → 밖으로 튀어나오기
    const inStartAnim = nowMs < state.startAnimUntil;
    if (inStartAnim) {
      const t = 1 - (state.startAnimUntil - nowMs) / state.startAnimDur;
      const e = smoothstep(t);
      const burst = 42;
      r.x = r.spawnX + burst * e;
      continue;
    }

    // ? 신발끈 멈춤 처리(움직이지 않음)
    if (r.laceStopped) {
      if (nowMs >= r.laceEndMs) {
        r.laceStopped = false;
      } else {
        r.x = Math.min(r.x, FINISH_X - 6);
        continue;
      }
    }

    // ? 연출 보정값(드라마)
    let directorBias = 0;
    if (state.directorOn && state.coffeeIdx != null) {
      const isCoffee = r.lane === state.coffeeIdx;

      if (p >= MID_START && p < MID_END) {
        const t = smoothstep((p - MID_START) / (MID_END - MID_START));
        if (isCoffee) directorBias += 0.8 + 1.0 * t;
        else directorBias += 0.15 + 0.25 * t;
      }

      if (p >= MID_END && p < FINAL) {
        const t = smoothstep((p - MID_END) / (FINAL - MID_END));
        if (isCoffee) directorBias += 0.2 - 1.4 * t;
        else directorBias += 0.1 - 0.2 * t;
      }

      if (p >= FINAL) {
        const t = smoothstep((p - FINAL) / (1 - FINAL));
        const chaos = (Math.random() - 0.5) * 0.9;
        const nearFinish = p >= 0.97;
        if (isCoffee) directorBias += chaos + (nearFinish ? -2.2 : -0.6) * t;
        else directorBias += chaos + (nearFinish ? +0.4 : +0.1) * t;
      }
    }

    // ? 완주 시간 안정화를 위해 하한 상향
    const speedMps = clamp(r.baseSpeed + r.buff + directorBias, 3.6, 13.5);
    const prevX = r.x;
    const dx = speedMps * PX_PER_M * dt;
    const nextX = prevX + dx;
    r.x = nextX;

    if (r.x >= FINISH_X) {
      // ? 프레임 내부 보간: 같은 프레임 동시 골인으로 인한 순서 흔들림 완화
      const denom = nextX - prevX;
      const ratio = denom > 0 ? (FINISH_X - prevX) / denom : 1;
      const crossMs = nowMs - (1 - clamp(ratio, 0, 1)) * (dt * 1000);

      r.x = FINISH_X;
      r.finished = true;
      r.finishTime = (crossMs - state.t0) / 1000;
      r.finishOrder = ++state.finishSeq;

      // ? 들어오는 순서대로 화면 포커스(잠깐)
      state.focusRunnerIdx = r.lane;
      state.focusUntilMs = nowMs + state.focusHoldMs;
    }
  }

  // leader 표시 (미완주 우선)
  const leader =
    state.runners
      .filter((r) => !r.finished)
      .sort((a, b) => b.x - a.x)[0] || [...state.runners].sort((a, b) => b.x - a.x)[0];

  UI.leader.textContent = `현재 1등: ${leader?.name ?? "-"}`;

  // progress bar (leader-based)
  const pct = clamp(((leader.x - TRACK_START_X) / (FINISH_X - TRACK_START_X)) * 100, 0, 100);
  UI.meterFill.style.width = `${pct.toFixed(1)}%`;

  // camera follow (줌 고려)
  // - 기본은 선두
  // - 누군가 골인하면 골인 순서대로 잠깐씩 포커스
  let camTarget = leader;
  if (state.focusRunnerIdx != null && nowMs < state.focusUntilMs) {
    camTarget = state.runners[state.focusRunnerIdx] || leader;
  }

  const viewW = W / camZoom;
  const targetCam = clamp(camTarget.x - viewW * 0.35, 0, FINISH_X - viewW + 40);
  camX += (targetCam - camX) * 0.10;

  // finish
  if (state.runners.every((r) => r.finished)) {
    finishAndShowResults();
  }
}

// ===== Draw =====
function drawTrack() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 구간: 회사(0~30m) / 거리(30~80m) / 카페(80~100m)
  const officeEnd = TRACK_START_X + 30 * PX_PER_M;
  const streetEnd = TRACK_START_X + 80 * PX_PER_M;

  function segToScreen(x0, x1) {
    const sx0 = worldToScreenX(x0);
    const sx1 = worldToScreenX(x1);
    return { sx0, sx1, w: sx1 - sx0 };
  }

  const segOffice = segToScreen(TRACK_START_X, officeEnd);
  const segStreet = segToScreen(officeEnd, streetEnd);
  const segCafe = segToScreen(streetEnd, FINISH_X);

  // 회사
  if (segOffice.w > 0) {
    ctx.fillStyle = "rgba(59,130,246,0.08)";
    ctx.fillRect(segOffice.sx0, 0, segOffice.w, H);

    const bW = Math.min(segOffice.w * 0.65, 260);
    const bH = 210;
    const bx = segOffice.sx0 + 18;
    const by = H - bH - 48;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(bx, by, bW, bH);

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
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        const wx = bx + pad + cx * (ww + 6);
        const wy = by + pad + ry * (wh + 10) + 24;
        ctx.fillRect(wx, wy, ww, wh);
      }
    }

    // 문(열림)
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

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(doorX, doorY, doorW * 0.5 - gap * 0.5, doorH);
    ctx.fillRect(doorX + doorW * 0.5 + gap * 0.5, doorY, doorW * 0.5 - gap * 0.5, doorH);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(doorX + doorW * 0.5 - gap * 0.5, doorY, gap, doorH);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui";
    ctx.fillText("?? 회사", segOffice.sx0 + 18, 26);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("출발!", segOffice.sx0 + 18, 44);
  }

  // 거리
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

    ctx.font = "16px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("?? 거리", segStreet.sx0 + 18, 26);
  }

  // 카페
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
    ctx.fillText("? COFFEE", cx + 30, cy + 46);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui";
    ctx.fillText("? 카페", segCafe.sx0 + 18, 26);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("목적지!", segCafe.sx0 + 18, 44);
  }

  // 레인 라인
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  for (const r of state.runners) {
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(TRACK_START_X), r.y + 18);
    ctx.lineTo(worldToScreenX(FINISH_X), r.y + 18);
    ctx.stroke();
  }

  // 거리 마커(0/50/100m)
  const markers = [0, 50, 100].map((m) => TRACK_START_X + m * PX_PER_M);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "12px system-ui";
  markers.forEach((mx, i) => {
    const sx = worldToScreenX(mx);
    ctx.fillRect(sx, 0, 1, H);
    const label = i === 0 ? "0m" : i === 1 ? "50m" : "100m";
    ctx.fillText(label, sx + 4, 16);
  });

  // 결승선
  const fx = worldToScreenX(FINISH_X);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(fx, 0, 3, H);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "14px system-ui";
  ctx.fillText("??", fx - 22, 28);
}

function drawSpeechBubble(text, x, y) {
  ctx.save();
  ctx.font = "14px system-ui";
  const paddingX = 10;
  const w = ctx.measureText(text).width + paddingX * 2;
  const h = 26;
  const bx = x - w / 2;
  const by = y - h;

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 2;

  const r = 10;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + w - r, by);
  ctx.quadraticCurveTo(bx + w, by, bx + w, by + r);
  ctx.lineTo(bx + w, by + h - r);
  ctx.quadraticCurveTo(bx + w, by + h, bx + w - r, by + h);
  ctx.lineTo(bx + r, by + h);
  ctx.quadraticCurveTo(bx, by + h, bx, by + h - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // tail
  ctx.beginPath();
  ctx.moveTo(x - 8, by + h);
  ctx.lineTo(x + 2, by + h);
  ctx.lineTo(x - 2, by + h + 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, by + h / 2);
  ctx.restore();
}

function drawRunners() {
  for (const r of state.runners) {
    const sx = worldToScreenX(r.x);

    // 이름
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui";
    ctx.fillText(r.name, sx - 10, r.y - 6);

    const img = runnerSprites.length ? runnerSprites[r.spriteIndex % runnerSprites.length] : null;
    const size = 52;
    const drawX = sx - size / 2;
    const drawY = r.y + 2;

    if (img) {
      const inStartAnim = state.running && performance.now() < state.startAnimUntil;
      const speedMps = clamp(r.baseSpeed + r.buff, 2.8, 10.5);
      const fps = inStartAnim ? 9 : 8 + speedMps;

      const t = performance.now() / 1000;
      const frame = r.finished ? 0 : Math.floor(t * fps) % SHEET_FRAMES;
      const sw = Math.floor(img.width / SHEET_FRAMES);
      const sh = img.height;

      const bobAmp = inStartAnim ? 3.0 : 2.0;
      const bob = r.finished ? 0 : Math.sin(t * fps * 0.55 + r.lane) * bobAmp;

      ctx.globalAlpha = r.finished ? 0.45 : 1.0;
      ctx.drawImage(img, frame * sw, 0, sw, sh, drawX, drawY + bob, size, size);
      ctx.globalAlpha = 1.0;
    } else {
      ctx.beginPath();
      ctx.arc(sx, r.y + 18, 12, 0, Math.PI * 2);
      ctx.fillStyle = r.finished ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)";
      ctx.fill();
    }

    // ? 신발끈 말풍선(멈춘 동안)
    if (r.laceStopped) {
      drawSpeechBubble(state.laceText, sx, r.y - 18);
    }

    // 버프 아이콘
    if (!r.finished && r.buff !== 0 && performance.now() >= state.startAnimUntil) {
      ctx.fillStyle = r.buff > 0 ? "rgba(34,197,94,0.9)" : "rgba(249,115,22,0.9)";
      ctx.font = "14px system-ui";
      ctx.fillText(r.buff > 0 ? "?" : "??", sx + 26, r.y + 18);
    }
  }
}

function draw() {
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
    ctx.fillText("골인 순서대로 포커스 이동…", 12, H - 14);
  }

  ctx.restore();
}

// ===== Loop (slow motion + zoom) =====
let last = performance.now();
function loop(now) {
  let dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  // ? 슬로우 모션 + 줌(결승 근처)
  // 15초 내 완주를 위해 슬로우모션을 '덜' 걸어줌
  if (state.running && state.runners.length) {
    const leaderX = Math.max(...state.runners.map((r) => r.x));
    const p = clamp((leaderX - TRACK_START_X) / (FINISH_X - TRACK_START_X), 0, 1);

    const t = smoothstep((p - 0.90) / 0.07);
    const slow = lerp(1.0, 0.55, t); // (기존 0.35보다 완화)
    dt *= slow;

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
function openModal() {
  UI.modal.classList.remove("hidden");
}
function closeModal() {
  UI.modal.classList.add("hidden");
}

// ===== Events =====
UI.addBtn.addEventListener("click", () => addName());
UI.nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addName();
});

UI.sampleBtn.addEventListener("click", () => {
  names = ["준혁", "민수", "지은", "영희", "철수", "수진"];
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
    ...state.results.map((r, i) => `${i + 1}등 ${r.name} (${r.finishTime.toFixed(2)}s)`),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    UI.status.textContent = "결과 복사 완료!";
  } catch {
    UI.status.textContent = "복사 실패(브라우저 권한 확인)";
  }
});

// init
renderChips();
UI.status.textContent = "대기중";
