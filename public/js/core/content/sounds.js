// Sounds books link (SPEC §3.5 `media`): which links name one, which archive entries are one, and
// which are MIDI (played through the synthesizer: no browser plays MIDI itself). Shared by the
// core (conversion, resolveLink), the reader (media/player.js) and the static build.

/**
 * An archive path that names a sound: a link to one is kept as a book is converted and played when
 * followed. Gutenberg's books link MIDI and MP3 files ("Listen"), or embed an <audio> player.
 */
export const SOUND_PATH = /\.(?:mid|midi|kar|rmi|mp3|m4a|aac|oga|ogg|opus|wav|flac)$/i;

/** The MIME types of sounds (MIDI is audio/midi, or audio/x-midi, application/x-midi). */
export const SOUND_MIME = /^audio\/|midi/i;

/** True for a MIDI file (by its type, else its name). */
export const isMidi = (media) => /midi/i.test(media?.mime ?? '') || /\.(?:mid|midi|kar|rmi)$/i.test(media?.name ?? '');
