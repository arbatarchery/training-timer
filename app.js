'use strict';

// ── Audio ──────────────────────────────────────────────────────────
let audioCtx = null;
let scheduledNodes = [];

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Called synchronously inside a user gesture to unlock audio on iOS.
// Creates the context, resumes it, and plays a silent buffer — required
// on older iOS where the context stays suspended without this trick.
function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    ctx.resume();
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) {}
}

// Schedule a single beep at an absolute audio-clock time.
// Using the audio clock (ctx.currentTime) instead of setTimeout means
// iOS setInterval throttling cannot delay or skip beeps.
function scheduleBeepAt(freq, dur, type, gain, when) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(gain, when);
    vol.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.start(when);
    osc.stop(when + dur);
    scheduledNodes.push(osc);
    osc.onended = () => {
      const i = scheduledNodes.indexOf(osc);
      if (i >= 0) scheduledNodes.splice(i, 1);
    };
  } catch (_) {}
}

// Stop and release all pre-scheduled nodes (called on step change / reset / back).
function cancelScheduledAudio() {
  scheduledNodes.forEach(osc => { try { osc.stop(0); } catch (_) {} });
  scheduledNodes = [];
}

// Pre-schedule every beep for a step at step-start using the audio clock.
// ctx.resume() is awaited first so the clock is running before we read currentTime.
// Because ctx.currentTime freezes when the context is suspended (pause), and
// resumes from the same position on ctx.resume(), beeps stay in sync with the
// visual countdown automatically across pause/resume cycles.
function scheduleAllBeepsForStep(step) {
  const ctx = getAudioCtx();
  ctx.resume().then(() => {
    const now = ctx.currentTime;

    // Transition beep — two-tone, plays immediately at phase start
    scheduleBeepAt(1200, 0.25, 'square', 0.35, now);
    scheduleBeepAt(1500, 0.2,  'square', 0.3,  now + 0.2);

    // Entre phase — 440 Hz sine tick on every elapsed second
    if (step.type === 'entre') {
      for (let i = 1; i < step.duration; i++) {
        scheduleBeepAt(440, 0.06, 'sine', 0.4, now + i);
      }
    }

    // Countdown — 660 Hz beep at 5, 4, 3, 2, 1 seconds remaining
    const cStart = Math.min(5, step.duration - 1);
    for (let s = cStart; s >= 1; s--) {
      scheduleBeepAt(660, 0.1, 'sine', 0.5, now + (step.duration - s));
    }
  });
}

function doneBeep() {
  const ctx = getAudioCtx();
  ctx.resume().then(() => {
    const now = ctx.currentTime;
    scheduleBeepAt(880,  0.2,  'square', 0.4, now);
    scheduleBeepAt(1100, 0.2,  'square', 0.4, now + 0.2);
    scheduleBeepAt(1320, 0.35, 'square', 0.4, now + 0.4);
  });
}

// ── Sequence builder ───────────────────────────────────────────────
function buildSequence(cfg) {
  const seq = [];
  seq.push({ type: 'prep', label: 'PREPARACIÓN', duration: cfg.prepTime, series: 0, exercise: 0 });
  for (let s = 1; s <= cfg.sets; s++) {
    for (let e = 1; e <= cfg.exercisesPerSet; e++) {
      seq.push({ type: 'work', label: `SERIE ${s} · EJERCICIO ${e}`, duration: cfg.workTime, series: s, exercise: e });
      if (e < cfg.exercisesPerSet && cfg.betweenTime > 0) {
        seq.push({ type: 'entre', label: 'ENTRE EJERCICIOS', duration: cfg.betweenTime, series: s, exercise: e });
      }
    }
    if (s < cfg.sets) {
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
let totalDuration = 0;
let elapsedSeconds = 0;

// ── DOM refs ───────────────────────────────────────────────────────
const countdownEl    = document.getElementById('countdown');
const phaseLabelEl   = document.getElementById('phase-label');
const phaseBarFill   = document.getElementById('phase-bar-fill');
const progressDots   = document.getElementById('progress-dots');
const nextPhaseEl    = document.getElementById('next-phase');
const seriesIndicEl  = document.getElementById('series-indicator');
const doneOverlay    = document.getElementById('done-overlay');
const btnPause       = document.getElementById('btn-pause');
const elapsedEl      = document.getElementById('elapsed-time');
const remainingEl    = document.getElementById('remaining-time');

// ── Screen navigation ──────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Start ──────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  unlockAudio();
  cfg = {
    prepTime:        parseInt(document.getElementById('prepTime').value)        || 10,
    workTime:        parseInt(document.getElementById('workTime').value)        || 30,
    betweenTime:     (v => v === '' || isNaN(v) ? 10 : v)(parseInt(document.getElementById('betweenTime').value)),
    exercisesPerSet: parseInt(document.getElementById('exercisesPerSet').value) || 4,
    sets:            parseInt(document.getElementById('sets').value)            || 4,
    restTime:        parseInt(document.getElementById('restTime').value)        || 120,
  };
  sequence = buildSequence(cfg);
  stepIndex = 0;
  paused = false;
  elapsedSeconds = 0;
  totalDuration = sequence.reduce((s, p) => s + p.duration, 0);
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

  document.body.className = 'phase-' + step.type;

  phaseLabelEl.textContent = step.label;
  if (step.type === 'work' || step.type === 'entre') {
    seriesIndicEl.textContent = `Serie ${step.series} / ${cfg.sets}`;
  } else if (step.type === 'rest') {
    seriesIndicEl.textContent = `Descanso · Serie ${step.series} de ${cfg.sets}`;
  } else {
    seriesIndicEl.textContent = '';
  }

  updateDots();
  updateNextPhase();
  cancelScheduledAudio();
  scheduleAllBeepsForStep(step);
  tick();
}

// setInterval drives only the visual counter and elapsed time.
// All audio is pre-scheduled via the Web Audio clock and fires independently.
function tick() {
  render();
  updateTimeTotals();
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (paused) return;
    secondsLeft--;
    elapsedSeconds++;
    if (secondsLeft <= 0) {
      clearInterval(timerId);
      stepIndex++;
      startStep();
      return;
    }
    render();
    updateTimeTotals();
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
  const labels = { prep: 'Preparación', work: next.label, rest: 'Descanso', entre: 'Entre Ejercicios' };
  nextPhaseEl.innerHTML = `A continuación: <span>${labels[next.type] || next.label}</span>`;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function updateTimeTotals() {
  elapsedEl.textContent   = fmtTime(elapsedSeconds);
  remainingEl.textContent = fmtTime(Math.max(0, totalDuration - elapsedSeconds));
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
  unlockAudio();
  paused = !paused;
  // Suspend/resume the audio context so the pre-scheduled beeps pause and
  // resume in lockstep with the visual countdown (ctx.currentTime freezes
  // during suspend, keeping audio offsets perfectly aligned).
  if (paused) {
    audioCtx && audioCtx.suspend();
  } else {
    audioCtx && audioCtx.resume();
  }
  btnPause.textContent = paused ? 'Reanudar' : 'Pausa';
  btnPause.className   = paused ? 'btn btn-resume' : 'btn btn-pause';
});

document.getElementById('btn-reset').addEventListener('click', () => {
  clearInterval(timerId);
  cancelScheduledAudio();
  if (audioCtx) audioCtx.resume();
  stepIndex     = 0;
  elapsedSeconds = 0;
  paused        = false;
  btnPause.textContent = 'Pausa';
  btnPause.className   = 'btn btn-pause';
  doneOverlay.classList.remove('visible');
  buildDots();
  startStep();
});

document.getElementById('btn-back').addEventListener('click', () => {
  clearInterval(timerId);
  cancelScheduledAudio();
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
