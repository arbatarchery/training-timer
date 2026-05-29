'use strict';

// ── Audio ──────────────────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq = 880, duration = 0.12, type = 'sine', gain = 0.4) {
  try {
    const ctx = getAudioCtx();
    const play = () => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.type = type;
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(gain, ctx.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    };
    if (ctx.state === 'running') { play(); } else { ctx.resume().then(play); }
  } catch (_) {}
}

function transitionBeep() {
  beep(1200, 0.25, 'square', 0.35);
  setTimeout(() => beep(1500, 0.2, 'square', 0.3), 200);
}

function countdownBeep() {
  beep(660, 0.1, 'sine', 0.5);
}

function doneBeep() {
  beep(880, 0.2, 'square', 0.4);
  setTimeout(() => beep(1100, 0.2, 'square', 0.4), 200);
  setTimeout(() => beep(1320, 0.35, 'square', 0.4), 400);
}

// ── Sequence builder ───────────────────────────────────────────────
function buildSequence(cfg) {
  const seq = [];
  seq.push({ type: 'prep', label: 'PREPARACIÓN', duration: cfg.prepTime, series: 0, exercise: 0 });
  for (let s = 1; s <= cfg.sets; s++) {
    for (let e = 1; e <= cfg.exercisesPerSet; e++) {
      seq.push({ type: 'work', label: `SERIE ${s} · EJERCICIO ${e}`, duration: cfg.workTime, series: s, exercise: e });
    }
    const isLast = s === cfg.sets;
    if (!isLast) {
      seq.push({ type: 'rest', label: 'DESCANSO', duration: cfg.restTime, series: s, exercise: 0 });
    }
  }
  return seq;
}

// ── State ──────────────────────────────────────────────────────────
let sequence = [];
let stepIndex = 0;
let secondsLeft = 0;
let stepDuration = 0;
let timerId = null;
let paused = false;
let cfg = {};

// ── DOM refs ───────────────────────────────────────────────────────
const configScreen   = document.getElementById('config-screen');
const timerScreen    = document.getElementById('timer-screen');
const countdownEl    = document.getElementById('countdown');
const phaseLabelEl   = document.getElementById('phase-label');
const phaseBarFill   = document.getElementById('phase-bar-fill');
const progressDots   = document.getElementById('progress-dots');
const nextPhaseEl    = document.getElementById('next-phase');
const seriesIndicEl  = document.getElementById('series-indicator');
const doneOverlay    = document.getElementById('done-overlay');
const btnPause       = document.getElementById('btn-pause');

// ── Screen navigation ──────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Start ──────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  cfg = {
    prepTime:        parseInt(document.getElementById('prepTime').value)        || 10,
    workTime:        parseInt(document.getElementById('workTime').value)        || 30,
    exercisesPerSet: parseInt(document.getElementById('exercisesPerSet').value) || 4,
    sets:            parseInt(document.getElementById('sets').value)            || 4,
    restTime:        parseInt(document.getElementById('restTime').value)        || 120,
  };
  sequence = buildSequence(cfg);
  stepIndex = 0;
  paused = false;
  doneOverlay.classList.remove('visible');
  buildDots();
  showScreen('timer-screen');
  startStep();
});

// ── Build progress dots ────────────────────────────────────────────
function buildDots() {
  const workSteps = sequence.filter(s => s.type === 'work');
  progressDots.innerHTML = '';
  workSteps.forEach(() => {
    const d = document.createElement('div');
    d.className = 'dot';
    progressDots.appendChild(d);
  });
}

function updateDots() {
  const dots = progressDots.querySelectorAll('.dot');
  let workCount = 0;
  sequence.slice(0, stepIndex).forEach(s => { if (s.type === 'work') workCount++; });
  const current = sequence[stepIndex];
  dots.forEach((d, i) => {
    d.className = 'dot';
    if (i < workCount) d.classList.add('done');
    else if (i === workCount && current && current.type === 'work') d.classList.add('active');
  });
}

// ── Step logic ─────────────────────────────────────────────────────
function startStep() {
  if (stepIndex >= sequence.length) { finish(); return; }
  const step = sequence[stepIndex];
  stepDuration = step.duration;
  secondsLeft  = step.duration;

  // Phase class on body
  document.body.className = 'phase-' + step.type;

  // Labels
  phaseLabelEl.textContent = step.label;
  if (step.type === 'work') {
    seriesIndicEl.textContent = `Serie ${step.series} / ${cfg.sets}`;
  } else if (step.type === 'rest') {
    seriesIndicEl.textContent = `Descanso · Serie ${step.series} de ${cfg.sets}`;
  } else {
    seriesIndicEl.textContent = '';
  }

  updateDots();
  updateNextPhase();
  transitionBeep();
  tick();
}

function tick() {
  render();
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (paused) return;
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(timerId);
      stepIndex++;
      startStep();
      return;
    }
    if (secondsLeft >= 1 && secondsLeft <= 5) countdownBeep();
    render();
  }, 1000);
}

function render() {
  countdownEl.textContent = secondsLeft;
  const pct = stepDuration > 0 ? (secondsLeft / stepDuration) * 100 : 0;
  phaseBarFill.style.width = pct + '%';
}

function updateNextPhase() {
  const next = sequence[stepIndex + 1];
  if (!next) { nextPhaseEl.innerHTML = ''; return; }
  const labels = { prep: 'Preparación', work: next.label, rest: 'Descanso' };
  nextPhaseEl.innerHTML = `A continuación: <span>${labels[next.type] || next.label}</span>`;
}

// ── Finish ─────────────────────────────────────────────────────────
function finish() {
  clearInterval(timerId);
  document.body.className = 'phase-done';
  countdownEl.textContent = '✓';
  phaseLabelEl.textContent = '¡COMPLETADO!';
  doneOverlay.classList.add('visible');
  doneBeep();
}

// ── Controls ───────────────────────────────────────────────────────
btnPause.addEventListener('click', () => {
  paused = !paused;
  btnPause.textContent = paused ? 'Reanudar' : 'Pausa';
  btnPause.className   = paused ? 'btn btn-resume' : 'btn btn-pause';
  if (!paused && getAudioCtx().state === 'suspended') getAudioCtx().resume();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  clearInterval(timerId);
  stepIndex  = 0;
  paused     = false;
  btnPause.textContent = 'Pausa';
  btnPause.className   = 'btn btn-pause';
  doneOverlay.classList.remove('visible');
  buildDots();
  startStep();
});

document.getElementById('btn-back').addEventListener('click', () => {
  clearInterval(timerId);
  showScreen('config-screen');
});

document.getElementById('btn-done-back').addEventListener('click', () => {
  clearInterval(timerId);
  doneOverlay.classList.remove('visible');
  showScreen('config-screen');
});

// ── Service Worker ─────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
