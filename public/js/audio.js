// Tiny WebAudio synthesizer for UI sounds (no audio files): page turns, a book sliding off the
// shelf, a soft thud, clicks. Every function is a safe no-op until init() runs on a user gesture
// (browsers keep audio suspended before that) or while sound is disabled. It also keeps the page's
// one <audio> element for the books' recordings (mediaElement), unlocked on the first tap.

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;
let mediaEl = null; // the <audio> the books' recordings play in (media/player.js): one for the page
let mediaPrimed = false;

/** A tenth of a second of silence, as a WAV (8 kHz, 8-bit) data URL. */
function silence() {
  const n = 800;
  const b = new Uint8Array(44 + n);
  const dv = new DataView(b.buffer);
  const tag = (at, s) => { for (let i = 0; i < 4; i++) b[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  tag(36, 'data');
  dv.setUint32(40, n, true);
  b.fill(128, 44); // 8-bit silence
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(s)}`;
}

/**
 * On a tap, once: the recordings' <audio> plays a moment of silence while it holds nothing. A
 * browser that lets media play only from a tap (Safari; others on a page not yet tapped) then lets
 * that element play later, after a recording's bytes have been fetched: media/player.js plays every
 * recording in it. Before, each recording had an element of its own, started after the fetch, and
 * stayed silent there while MIDI songs played (the audio context is resumed on the tap itself).
 */
function primeMedia() {
  if (mediaPrimed || typeof Audio !== 'function') return;
  const el = audio.mediaElement();
  if (el.getAttribute('src')) return; // a recording is in it
  mediaPrimed = true;
  const quiet = silence();
  el.src = quiet;
  let played = null;
  try {
    played = el.play();
  } catch (err) {
    played = Promise.reject(err);
  }
  const done = () => {
    if (el.getAttribute('src') !== quiet) return; // a recording took it meanwhile
    el.pause();
    el.removeAttribute('src');
    el.load();
  };
  Promise.resolve(played).then(done, (err) => {
    if (err?.name === 'NotAllowedError') mediaPrimed = false; // not a tap after all: the next one
    done();
  });
}

function noise() {
  if (!noiseBuf) {
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

function ready() {
  return ctx && enabled && ctx.state === 'running';
}

/** Filtered noise burst with an envelope. */
function burst({ dur, gain = 0.3, type = 'bandpass', f0, f1, q = 1, attack = 0.01, delay = 0 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const src = noise();
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone({ dur, gain = 0.2, f0, f1 = f0, type = 'sine', delay = 0 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const audio = {
  /** Creates/resumes the audio context; call from a user gesture (click, tap, XR select). */
  init() {
    primeMedia();
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch { /* audio unavailable */ }
  },
  /**
   * The audio context, once init() has made it (else null). The sounds books play go through it
   * too (media/player.js), not through these sounds' volume, and whether UI sounds are on.
   */
  get context() {
    return ctx;
  },
  /** The <audio> element every recording plays in (media/player.js): one for the page, unlocked on the first tap (init). */
  mediaElement() {
    mediaEl ??= new Audio();
    return mediaEl;
  },
  setEnabled(on) {
    enabled = !!on;
  },
  get enabled() {
    return enabled;
  },
  pageTurn() {
    burst({ dur: 0.28, gain: 0.22, f0: 5200, f1: 900, q: 0.8, attack: 0.03 });
    burst({ dur: 0.08, gain: 0.12, type: 'highpass', f0: 2500, f1: 2500, delay: 0.22 });
  },
  slide() {
    burst({ dur: 0.38, gain: 0.16, type: 'lowpass', f0: 1800, f1: 500, q: 0.7, attack: 0.04 });
  },
  thud() {
    tone({ dur: 0.16, gain: 0.25, f0: 140, f1: 60 });
    burst({ dur: 0.1, gain: 0.12, type: 'lowpass', f0: 900, f1: 200 });
  },
  click() {
    tone({ dur: 0.04, gain: 0.08, f0: 1800, f1: 1200, type: 'triangle' });
  },
  open() {
    burst({ dur: 0.5, gain: 0.14, f0: 2500, f1: 600, q: 0.6, attack: 0.06 });
    tone({ dur: 0.3, gain: 0.04, f0: 300, f1: 180, type: 'triangle', delay: 0.05 });
  },
  close() {
    burst({ dur: 0.25, gain: 0.14, f0: 1500, f1: 400, q: 0.7 });
    tone({ dur: 0.12, gain: 0.2, f0: 120, f1: 70, delay: 0.18 });
  },
};
