// Who wrote a sound, and when (SPEC §5.6 "Sounds": the Listen tab's Composers and Periods, the
// room laid out by period): guessed from the words around its link (its own, its paragraph's, its
// headings') and its book's title, by a list of composers and their years. Approximate by nature:
// a history book's example under "Pianoforte music at the time of Beethoven" counts as
// Beethoven's. Pure, so the tests run it in Node; the rules can change without the index (they
// are applied as the sound index is read).

/**
 * Composers: [name shown, born, died, the names that find them (lower case; longer, more
 * particular names first where one is part of another)].
 */
const COMPOSERS = [
  ['Hildegard of Bingen', 1098, 1179, ['hildegard']],
  ['Guillaume de Machaut', 1300, 1377, ['machaut']],
  ['Guillaume Dufay', 1397, 1474, ['dufay']],
  ['Josquin des Prez', 1450, 1521, ['josquin']],
  ['Thomas Tallis', 1505, 1585, ['tallis']],
  ['Giovanni Pierluigi da Palestrina', 1525, 1594, ['palestrina']],
  ['Orlande de Lassus', 1532, 1594, ['orlando di lasso', 'orlando lasso', 'orlande de lassus', 'lassus']],
  ['William Byrd', 1540, 1623, ['byrd']],
  ['Thomas Morley', 1557, 1602, ['thomas morley']],
  ['John Dowland', 1563, 1626, ['dowland']],
  ['Claudio Monteverdi', 1567, 1643, ['monteverdi']],
  ['Orlando Gibbons', 1583, 1625, ['orlando gibbons']],
  ['Girolamo Frescobaldi', 1583, 1643, ['frescobaldi']],
  ['Heinrich Schütz', 1585, 1672, ['schütz', 'schutz', 'schuetz']],
  ['Jean-Baptiste Lully', 1632, 1687, ['lully', 'lulli']],
  ['Arcangelo Corelli', 1653, 1713, ['corelli']],
  ['Henry Purcell', 1659, 1695, ['purcell']],
  ['Alessandro Scarlatti', 1660, 1725, ['alessandro scarlatti']],
  ['François Couperin', 1668, 1733, ['couperin']],
  ['Antonio Vivaldi', 1678, 1741, ['vivaldi']],
  ['Georg Philipp Telemann', 1681, 1767, ['telemann']],
  ['Jean-Philippe Rameau', 1683, 1764, ['rameau']],
  ['Domenico Scarlatti', 1685, 1757, ['domenico scarlatti', 'scarlatti']],
  ['George Frideric Handel', 1685, 1759, ['handel', 'händel', 'haendel']],
  ['Carl Philipp Emanuel Bach', 1714, 1788, ['c. p. e. bach', 'c.p.e. bach', 'emanuel bach', 'philipp emanuel bach']],
  ['Johann Sebastian Bach', 1685, 1750, ['sebastian bach', 'j. s. bach', 'j.s. bach', 'bach']],
  ['Giuseppe Tartini', 1692, 1770, ['tartini']],
  ['Giovanni Battista Pergolesi', 1710, 1736, ['pergolesi', 'pergolese']],
  ['Thomas Arne', 1710, 1778, ['thomas arne', 'dr. arne', 'dr arne']],
  ['Christoph Willibald Gluck', 1714, 1787, ['gluck']],
  ['Joseph Haydn', 1732, 1809, ['haydn']],
  ['Luigi Boccherini', 1743, 1805, ['boccherini']],
  ['William Billings', 1746, 1800, ['william billings']],
  ['Muzio Clementi', 1752, 1832, ['clementi']],
  ['Federigo Fiorillo', 1755, 1823, ['fiorillo']],
  ['Wolfgang Amadeus Mozart', 1756, 1791, ['mozart']],
  ['Luigi Cherubini', 1760, 1842, ['cherubini']],
  ['Ludwig van Beethoven', 1770, 1827, ['beethoven']],
  ['Niccolò Paganini', 1782, 1840, ['paganini']],
  ['Carl Maria von Weber', 1786, 1826, ['weber']],
  ['Giacomo Meyerbeer', 1791, 1864, ['meyerbeer']],
  ['Lowell Mason', 1792, 1872, ['lowell mason']],
  ['Gioachino Rossini', 1792, 1868, ['rossini']],
  ['Gaetano Donizetti', 1797, 1848, ['donizetti']],
  ['Franz Schubert', 1797, 1828, ['schubert']],
  ['Vincenzo Bellini', 1801, 1835, ['bellini']],
  ['Hector Berlioz', 1803, 1869, ['berlioz']],
  ['Mikhail Glinka', 1804, 1857, ['glinka']],
  ['Felix Mendelssohn', 1809, 1847, ['mendelssohn']],
  ['Frédéric Chopin', 1810, 1849, ['chopin']],
  ['Robert Schumann', 1810, 1856, ['schumann']],
  ['Franz Liszt', 1811, 1886, ['liszt']],
  ['Richard Wagner', 1813, 1883, ['wagner']],
  ['Giuseppe Verdi', 1813, 1901, ['verdi']],
  ['Charles Gounod', 1818, 1893, ['gounod']],
  ['Jacques Offenbach', 1819, 1880, ['offenbach']],
  ['César Franck', 1822, 1890, ['franck']],
  ['Joachim Raff', 1822, 1882, ['raff']],
  ['Anton Bruckner', 1824, 1896, ['bruckner']],
  ['Bedřich Smetana', 1824, 1884, ['smetana']],
  ['Johann Strauss II', 1825, 1899, ['johann strauss', 'strauss']],
  ['Stephen Foster', 1826, 1864, ['stephen foster', 'stephen c. foster']],
  ['Johannes Brahms', 1833, 1897, ['brahms']],
  ['Camille Saint-Saëns', 1835, 1921, ['saint-saëns', 'saint-saens', 'saint saens']],
  ['Max Bruch', 1838, 1920, ['max bruch', 'bruch']],
  ['Georges Bizet', 1838, 1875, ['bizet']],
  ['Josef Rheinberger', 1839, 1901, ['rheinberger']],
  ['Modest Mussorgsky', 1839, 1881, ['mussorgsky', 'moussorgsky', 'musorgsky']],
  ['Pyotr Ilyich Tchaikovsky', 1840, 1893, ['tchaikovsky', 'tschaikowsky', 'tchaikowsky', 'tschaikovsky']],
  ['Antonín Dvořák', 1841, 1904, ['dvořák', 'dvorak', 'dvorák']],
  ['Arthur Sullivan', 1842, 1900, ['sullivan']],
  ['Jules Massenet', 1842, 1912, ['massenet']],
  ['Edvard Grieg', 1843, 1907, ['grieg']],
  ['Nikolai Rimsky-Korsakov', 1844, 1908, ['rimsky-korsakov', 'rimsky-korsakoff', 'rimsky']],
  ['Gabriel Fauré', 1845, 1924, ['fauré', 'faure']],
  ['Engelbert Humperdinck', 1854, 1921, ['humperdinck']],
  ['John Philip Sousa', 1854, 1932, ['sousa']],
  ['Edward Elgar', 1857, 1934, ['elgar']],
  ['Ruggero Leoncavallo', 1857, 1919, ['leoncavallo']],
  ['Giacomo Puccini', 1858, 1924, ['puccini']],
  ['Gustav Mahler', 1860, 1911, ['mahler']],
  ['Edward MacDowell', 1860, 1908, ['macdowell', 'mac dowell']],
  ['Claude Debussy', 1862, 1918, ['debussy']],
  ['Pietro Mascagni', 1863, 1945, ['mascagni']],
  ['Richard Strauss', 1864, 1949, ['richard strauss']],
  ['Jean Sibelius', 1865, 1957, ['sibelius']],
  ['Alexander Scriabin', 1872, 1915, ['scriabin', 'skriabin']],
  ['Sergei Rachmaninoff', 1873, 1943, ['rachmaninoff', 'rachmaninov']],
  ['Arnold Schoenberg', 1874, 1951, ['schoenberg', 'schönberg']],
  ['Maurice Ravel', 1875, 1937, ['ravel']],
];

/** Periods, in time order: [id, name, the years they hold (by a composer's 35th year)]. */
export const PERIODS = [
  { id: 'ancient', name: 'Ancient and far-off music', years: '' },
  { id: 'medieval', name: 'Chant and the Middle Ages', years: 'to 1400', to: 1400 },
  { id: 'renaissance', name: 'Renaissance', years: '1400–1600', to: 1600 },
  { id: 'baroque', name: 'Baroque', years: '1600–1750', to: 1750 },
  { id: 'classical', name: 'Classical', years: '1750–1820', to: 1820 },
  { id: 'romantic', name: 'Romantic', years: '1820–1900', to: 1900 },
  { id: 'modern', name: 'Into the 20th century', years: 'from 1900', to: Infinity },
  { id: 'folk', name: 'Folk songs, ballads, hymns and carols', years: '' },
  { id: 'theory', name: 'Scales, exercises and theory', years: '' },
  { id: 'other', name: 'Other examples', years: '' },
];
export const periodOf = (id) => PERIODS.find((p) => p.id === id) ?? PERIODS.at(-1);

const byName = new Map();
const patterns = [];
for (const [name, born, died, keys] of COMPOSERS) {
  const c = { name, born, died };
  for (const k of keys) {
    byName.set(k, c);
    patterns.push(k);
  }
}
patterns.sort((a, b) => b.length - a.length); // "johann strauss" before "strauss"
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMES = new RegExp(`(?<![\\p{L}])(?:${patterns.map(esc).join('|')})(?![\\p{L}])`, 'iu');

/** Words that say what kind of music, when no composer is named (the period it is shelved in). */
const ANCIENT = /\b(?:greeks?|greek|egypt\w*|hindoo\w*|hindu\w*|chinese|japanese|siamese|burmese|javanese|arab\w*|hebrew\w*|assyrian|persian|ancient|orient\w*|pythagor\w*)\b/i;
const MEDIEVAL = /\b(?:gregorian|plain[- ]?song|plain[- ]?chant|chant|ambrosian|troubadours?|trouv[eè]res?|minnesinger\w*|organum|neumes?|medi(?:a)?eval|guido)\b/i;
const FOLK = /\b(?:folk[- ]?songs?|folk|ballads?|carols?|hymns?|spirituals?|shant(?:y|ies|eys?)|nursery|cowboy|songs of the|negro|traditional|psalms?|psalter|lullab(?:y|ies)|jigs?|reels?|airs?)\b/i;
const THEORY = /\b(?:scales?|intervals?|chords?|exercises?|lessons?|studies|study|etudes?|études?|modes?|dorian|phrygian|lydian|mixo-?lydian|aeolian|ionian|pentatonic|chromatic|cadences?|harmon(?:y|ies)|counterpoint|progressions?|triads?|arpeggios?|octaves?|thirds|sixths|velocity|breathing|vowels?)\b/i;

/** The composer a text names (the first found), or null. */
export function composerIn(text) {
  if (!text) return null;
  const m = NAMES.exec(text);
  return m ? byName.get(m[0].toLowerCase()) ?? null : null;
}

/** A composer's period: by the year they were 35 (their work's middle, roughly). */
export function composerPeriod(c) {
  const year = Math.min(c.born + 35, c.died);
  return PERIODS.find((p) => p.to !== undefined && year < p.to)?.id ?? 'modern';
}

/**
 * Who wrote a sound and when, from its words (its link's, its paragraph's, its headings', in
 * that order) and its book's title: { composer|null, period }. A book whose title names one
 * composer ("Beethoven", "The Life of Mozart") gives its sounds that name when they name none.
 * @param {object} sound a sound list entry (SPEC §3.5 sound lists)
 * @param {{ title?: string, subtitle?: string }} [book]
 */
export function attribute(sound, book = null) {
  const own = [sound.t, sound.x, sound.h, sound.p];
  let composer = null;
  for (const text of own) if ((composer = composerIn(text))) break;
  const title = book ? `${book.title ?? ''} ${book.subtitle ?? ''}` : '';
  composer ??= composerIn(title);
  if (composer) return { composer, period: composerPeriod(composer) };
  const words = `${own.filter(Boolean).join(' ')} ${title}`;
  const said = own.filter(Boolean).join(' ');
  // What the sound's own words say first, then its book's title.
  for (const text of [said, words]) {
    if (MEDIEVAL.test(text)) return { composer: null, period: 'medieval' };
    if (ANCIENT.test(text)) return { composer: null, period: 'ancient' };
    if (FOLK.test(text)) return { composer: null, period: 'folk' };
    if (THEORY.test(text)) return { composer: null, period: 'theory' };
  }
  return { composer: null, period: 'other' };
}

/**
 * Every sound of the sound indexes, attributed: [{ libId, bookId, sound, composer, period }], in
 * the indexes' order; and the composers (with how many sounds each, by birth) and the periods
 * (in time order, with how many), as the Listen tab lists them.
 * @param {Array<{ libId: string, books: Array<{ id: string, sounds: object[] }> }>} indexes
 * @param {(libId: string, bookId: string) => object|null} bookOf
 */
export function attributeAll(indexes, bookOf) {
  const items = [];
  const composers = new Map();
  const periods = new Map(PERIODS.map((p) => [p.id, 0]));
  for (const { libId, books } of indexes) {
    for (const { id, sounds } of books) {
      const book = bookOf(libId, id);
      for (const sound of sounds) {
        const { composer, period } = attribute(sound, book);
        items.push({ libId, bookId: id, sound, composer, period });
        periods.set(period, periods.get(period) + 1);
        if (composer) {
          if (!composers.has(composer.name)) composers.set(composer.name, { ...composer, count: 0, books: new Set() });
          const c = composers.get(composer.name);
          c.count++;
          c.books.add(`${libId}\n${id}`);
        }
      }
    }
  }
  return {
    items,
    composers: [...composers.values()].sort((a, b) => a.born - b.born || a.name.localeCompare(b.name)),
    periods: PERIODS.map((p) => ({ ...p, count: periods.get(p.id) })).filter((p) => p.count),
  };
}

/**
 * A book's period: the one most of its sounds are of (the named ones first: a history book's
 * scales do not make it a theory book), else 'other'.
 * @param {Array<{ period: string, composer: object|null }>} items its sounds, attributed
 */
export function bookPeriod(items) {
  const count = new Map();
  for (const it of items) {
    const w = it.composer ? 3 : it.period === 'other' ? 0 : 1;
    if (w) count.set(it.period, (count.get(it.period) ?? 0) + w);
  }
  let best = 'other';
  let n = 0;
  for (const [p, k] of count) {
    if (k > n) {
      best = p;
      n = k;
    }
  }
  return best;
}
