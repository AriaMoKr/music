// The sound a book plays (SPEC §3.5 `media`, a link followed in the reader): a MIDI file through
// the synthesizer (synth.js), any other sound (MP3, and what else the browser plays) through an
// <audio> element. One at a time: playing another stops it. The reader's toolbar shows it and
// its controls (interaction.js).
import { perf } from '../perf.js';
import { isMidi } from '../core/content/sounds.js';
import { midiSong, parseMidi } from './midi.js';
import { MidiSynth, RATE_MAX, RATE_MIN } from './synth.js';

export { SOUND_PATH, isMidi } from '../core/content/sounds.js';

/** How long a song waits for its sampled instruments (ms) before it starts with what has come (the rest join as they do). */
export const SAMPLES_WAIT_MS = 5000;

/**
 * Each <audio> element's MediaElementSourceNode: an element gets at most one, ever, and once it has
 * one its sound goes only through it. The page plays every recording in one element (audio.js
 * mediaElement), so its node is kept and connected anew for each sound.
 */
const SOURCES = new WeakMap();

/** "1:05" for 65 seconds. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class SoundPlayer {
  /**
   * @param {object} o
   * @param {() => AudioContext|null} o.context the page's audio context, made and resumed on the
   *   gesture that leads here (audio.js)
   * @param {(media: object) => Promise<Uint8Array>} o.bytes a sound's bytes (api.soundBytes)
   * @param {(media: object) => Promise<{ url: string, release: () => void }>} o.url where an
   *   <audio> plays a sound from (api.soundUrl)
   * @param {() => HTMLAudioElement} [o.createAudio] the element a recording plays in: the page's one
   *   (audio.js mediaElement, unlocked on a tap), or a new one each time
   * @param {import('./samples.js').SampleBank|null} [o.samples] the sampled instruments, or none
   * @param {() => string} [o.instruments] 'sampled' or 'synth' (settings.midiInstruments): what a
   *   MIDI song is played with
   */
  constructor({ context, bytes, url, createAudio = () => new Audio(), samples = null, instruments = () => 'sampled' }) {
    this._context = context;
    this._bytes = bytes;
    this._url = url;
    this._createAudio = createAudio;
    this._samples = samples;
    this._instruments = instruments;
    /** The sound loaded (SPEC §3.5 `media`), or null. */
    this.media = null;
    /** 'idle', 'loading', 'playing', 'paused', or 'blocked' (the browser wants a tap on ▶ first). */
    this.state = 'idle';
    /** Called on every change of state. */
    this.onChange = null;
    /** Called with (message, media) when a sound cannot be played. */
    this.onError = null;
    /** Called with (media) when a sound has played to its end (after the change to 'idle'). */
    this.onEnded = null;
    this._synth = null;
    this._el = null;
    this._source = null; // the element's MediaElementSourceNode, when it plays through `destination`
    this._dest = null;
    this._rate = 1; // practice: the tempo (setRate), kept from sound to sound
    this._loop = null; // practice: { a, b } of the sound playing (setLoop)
    this._release = null;
    this._token = 0; // bumped by every play and stop: an older load that finishes is dropped
  }

  /** The MIDI song playing (midi.js midiSong's: the music stand's piano roll), or null. */
  get song() {
    return this._synth?.song ?? null;
  }

  /** The synthesizer playing it (practice: its parts, transpose), or null for a recording. */
  get synth() {
    return this._synth;
  }

  /**
   * Practice (SPEC §5.6 "Sounds"): its tempo (a MIDI song's through the synthesizer, a
   * recording's through the browser, its pitch kept), kept for the sounds played after it.
   */
  get rate() {
    return this._rate;
  }
  setRate(rate) {
    this._rate = Math.max(RATE_MIN, Math.min(RATE_MAX, rate));
    this._synth?.setRate(this._rate);
    if (this._el) this._el.playbackRate = this._rate;
  }

  /**
   * What the MIDI song playing is played with, from now on: 'sampled' (its sampled instruments,
   * loading while the oscillators play) or 'synth' (the oscillators alone). Later songs ask
   * `instruments()`.
   */
  setInstruments(kind) {
    const synth = this._synth;
    if (!synth) return;
    synth.setSamples(kind !== 'synth' && this._samples ? this._samples.voices(synth.ctx, synth.song, { transpose: synth.transpose }) : null);
  }

  /** Practice: goes round from b back to a (s), or not (null); for this sound only. */
  get loop() {
    return this._loop;
  }
  setLoop(loop) {
    this._loop = loop && loop.b - loop.a >= 0.25 ? { a: loop.a, b: loop.b } : null;
    this._synth?.setLoop(this._loop);
  }

  /**
   * A recording's loop: from its end back to its start, checked every frame (a song's goes round
   * in the synthesizer).
   */
  checkLoop() {
    const el = this._el;
    if (el && this._loop && this.state === 'playing' && el.currentTime >= this._loop.b) el.currentTime = this._loop.a;
  }

  /** Where the sound is, and how long it is (s; 0 until known). */
  get position() {
    return this._synth ? this._synth.position : this._el ? this._el.currentTime || 0 : 0;
  }
  get duration() {
    const d = this._synth ? this._synth.duration : this._el?.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * Loads a sound and plays it from its start, stopping the one before. `destination`: an audio
   * node it goes through (the gramophone's panner), else the speakers.
   */
  async play(media, { destination = null } = {}) {
    this.stop();
    const token = ++this._token;
    this.media = media;
    this._dest = destination;
    this._set('loading');
    try {
      if (isMidi(media)) await this._playMidi(media, token);
      else await this._playAudio(media, token);
    } catch (err) {
      if (token === this._token) this._fail(err);
    }
  }

  async _playMidi(media, token) {
    const ctx = this._context();
    if (!ctx) throw new Error('This browser cannot play sounds (it has no Web Audio).');
    const bytes = await this._bytes(media);
    if (token !== this._token) return;
    const t0 = performance.now();
    const song = midiSong(parseMidi(bytes));
    if (perf.enabled) perf.event('midi', { t: t0, ms: performance.now() - t0, notes: song.notes.length, kb: Math.round(bytes.length / 1024) });
    if (!song.notes.length) throw new Error('The MIDI file has no notes.');
    // Resumed on the tap that led here (audio.init); were it still suspended, its clock waits
    // and the song starts when it runs.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Its sampled instruments (samples.js), loaded first: at most SAMPLES_WAIT_MS, then it starts
    // with what has come, the oscillators playing the rest until theirs arrive.
    let samples = null;
    if (this._samples && this._instruments() !== 'synth') {
      const t1 = performance.now();
      samples = this._samples.voices(ctx, song);
      let timer = 0;
      await Promise.race([samples.ready, new Promise((resolve) => { timer = setTimeout(resolve, SAMPLES_WAIT_MS); })]);
      clearTimeout(timer);
      if (perf.enabled) perf.event('samples', { t: t1, ms: performance.now() - t1, files: samples.files, loaded: samples.loaded, mb: Math.round(this._samples.bytes / 104857.6) / 10 });
      if (token !== this._token) return;
    }
    this._synth = new MidiSynth(ctx, song, { ...(this._dest ? { destination: this._dest } : {}), samples });
    if (this._rate !== 1) this._synth.setRate(this._rate);
    this._synth.onEnd = () => this._ended(token);
    this._synth.play(0);
    this._set('playing');
  }

  async _playAudio(media, token) {
    const { url, release } = await this._url(media);
    if (token !== this._token) {
      release();
      return;
    }
    this._release = release;
    const el = this._createAudio();
    el.preload = 'auto';
    el.onended = () => this._ended(token);
    el.onerror = () => {
      if (token === this._token) this._fail(new Error(`The browser cannot play ${media.name || 'this sound'}.`));
    };
    el.src = url;
    el.preservesPitch = true; // slower or faster for practice, not lower or higher
    // The tempo kept from the sound before (the element may be the one it played in: a load
    // sets playbackRate back to defaultPlaybackRate).
    el.defaultPlaybackRate = this._rate;
    el.playbackRate = this._rate;
    this._el = el;
    // Through an audio node (the gramophone's): the element's sound goes there instead; an element
    // that has a node already (it played on the gramophone before) goes through it to the speakers.
    let source = SOURCES.get(el) ?? null;
    const ctx = this._dest || source ? this._context() : null;
    if (!source && this._dest && ctx?.createMediaElementSource) {
      source = ctx.createMediaElementSource(el);
      SOURCES.set(el, source);
    }
    if (source && ctx) {
      source.disconnect();
      source.connect(this._dest ?? ctx.destination);
      this._source = source;
    }
    await this._start(el, token);
  }

  /** <audio>.play(): refused without a recent tap in some browsers (blocked: ▶ is that tap). */
  async _start(el, token) {
    try {
      await el.play();
      if (token === this._token) this._set('playing');
    } catch (err) {
      if (token !== this._token) return;
      if (err?.name === 'NotAllowedError') this._set('blocked');
      else throw err;
    }
  }

  /** ▶ / ❚❚: plays a paused (or blocked) sound, pauses a playing one. */
  toggle() {
    if (this.state === 'playing') this.pause();
    else this.resume();
  }

  pause() {
    if (this.state !== 'playing') return;
    this._synth?.pause();
    this._el?.pause();
    this._set('paused');
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'blocked') return;
    if (this._synth) {
      if (this._synth.ctx.state === 'suspended') this._synth.ctx.resume().catch(() => {});
      this._synth.play();
      this._set('playing');
    } else if (this._el) {
      const token = this._token;
      this._start(this._el, token).catch((err) => {
        if (token === this._token) this._fail(err);
      });
    }
  }

  /** Stops and unloads the sound. */
  stop() {
    this._token++;
    this._synth?.dispose();
    this._synth = null;
    if (this._el) {
      const el = this._el;
      el.onended = el.onerror = null;
      el.pause();
      el.removeAttribute?.('src');
      el.load?.(); // lets go of what it buffered
      this._el = null;
    }
    this._source?.disconnect();
    this._source = null;
    this._loop = null;
    this._release?.();
    this._release = null;
    this.media = null;
    if (this.state !== 'idle') this._set('idle');
  }

  _ended(token) {
    if (token !== this._token) return;
    const media = this.media;
    this.stop();
    this.onEnded?.(media);
  }

  _fail(err) {
    const media = this.media;
    this.stop();
    console.warn('sound', media?.name ?? '', err);
    this.onError?.(err?.message ?? String(err), media);
  }

  _set(state) {
    this.state = state;
    this.onChange?.(state);
  }
}
