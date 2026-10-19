// The sound a book plays (SPEC §3.5 `media`, a link followed in the reader): a MIDI file through
// the synthesizer (synth.js), any other sound (MP3, and what else the browser plays) through an
// <audio> element. One at a time: playing another stops it. The reader's toolbar shows it and
// its controls (interaction.js).
import { perf } from '../perf.js';
import { isMidi } from '../core/content/sounds.js';
import { midiSong, parseMidi } from './midi.js';
import { MidiSynth } from './synth.js';

export { SOUND_PATH, isMidi } from '../core/content/sounds.js';

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
   * @param {() => HTMLAudioElement} [o.createAudio]
   */
  constructor({ context, bytes, url, createAudio = () => new Audio() }) {
    this._context = context;
    this._bytes = bytes;
    this._url = url;
    this._createAudio = createAudio;
    /** The sound loaded (SPEC §3.5 `media`), or null. */
    this.media = null;
    /** 'idle', 'loading', 'playing', 'paused', or 'blocked' (the browser wants a tap on ▶ first). */
    this.state = 'idle';
    /** Called on every change of state. */
    this.onChange = null;
    /** Called with (message, media) when a sound cannot be played. */
    this.onError = null;
    this._synth = null;
    this._el = null;
    this._release = null;
    this._token = 0; // bumped by every play and stop: an older load that finishes is dropped
  }

  /** Where the sound is, and how long it is (s; 0 until known). */
  get position() {
    return this._synth ? this._synth.position : this._el ? this._el.currentTime || 0 : 0;
  }
  get duration() {
    const d = this._synth ? this._synth.duration : this._el?.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /** Loads a sound and plays it from its start, stopping the one before. */
  async play(media) {
    this.stop();
    const token = ++this._token;
    this.media = media;
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
    this._synth = new MidiSynth(ctx, song);
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
    this._el = el;
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
    this._release?.();
    this._release = null;
    this.media = null;
    if (this.state !== 'idle') this._set('idle');
  }

  _ended(token) {
    if (token === this._token) this.stop();
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
