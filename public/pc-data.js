// Playcircle — fictional DJ library
// All track names, artists, and albums are invented. No copyrighted material.

const CAMELOT_COLORS = {
  '1A':  '#3a8a78', '1B':  '#4ea892',
  '2A':  '#3e8fae', '2B':  '#4ba9c7',
  '3A':  '#7a5cb0', '3B':  '#8e72c2',
  '4A':  '#a85a8e', '4B':  '#bf72a3',
  '5A':  '#b5435a', '5B':  '#c95a72',
  '6A':  '#b85e36', '6B':  '#cc7448',
  '7A':  '#b6802b', '7B':  '#c99a3d',
  '8A':  '#9aa235', '8B':  '#aeb845',
  '9A':  '#6da33b', '9B':  '#82b94c',
  '10A': '#3aa15a', '10B': '#4cb56e',
  '11A': '#2c9b86', '11B': '#3eb09a',
  '12A': '#3974b3', '12B': '#4d8acb',
};

// Camelot wheel order (clockwise starting at 8B, the "0" key in our visual)
const CAMELOT_ORDER = [
  '1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A',
  '1B','2B','3B','4B','5B','6B','7B','8B','9B','10B','11B','12B',
];

// Generate a procedural waveform: array of [low, high] peak pairs, normalized 0..1
function makeWaveform(seed, length = 256, character = 'house') {
  // Simple seeded RNG
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const peaks = [];
  // Section structure: intro / build / drop / breakdown / outro
  const sections = [
    { len: 0.10, energy: 0.35, vary: 0.25 },
    { len: 0.12, energy: 0.55, vary: 0.30 },
    { len: 0.08, energy: 0.40, vary: 0.20 }, // pre-drop dip
    { len: 0.30, energy: 0.95, vary: 0.20 },
    { len: 0.12, energy: 0.45, vary: 0.35 }, // breakdown
    { len: 0.20, energy: 0.85, vary: 0.20 },
    { len: 0.08, energy: 0.30, vary: 0.30 },
  ];
  let i = 0;
  for (const sec of sections) {
    const segLen = Math.floor(length * sec.len);
    for (let j = 0; j < segLen && i < length; j++, i++) {
      const t = j / segLen;
      // Gentle envelope
      const env = Math.sin(t * Math.PI) * 0.3 + 0.7;
      const base = sec.energy * env;
      const noise = (rand() - 0.5) * sec.vary;
      // Beat emphasis every ~4 samples
      const beat = (i % 4 === 0) ? 0.12 : 0;
      const high = Math.max(0.05, Math.min(1, base + noise + beat));
      const low = Math.max(0.02, high * (0.4 + rand() * 0.4));
      peaks.push([low, high]);
    }
  }
  while (peaks.length < length) peaks.push([0.05, 0.1]);
  return peaks;
}

// Energy curve: 24 samples per track for sparkline
function makeEnergyCurve(seed) {
  const wf = makeWaveform(seed, 24);
  return wf.map(([, h]) => h);
}

// ~40 invented tracks
const RAW_TRACKS = [
  // House / Tech house
  ['Magnetic North',         'Halun',                  'Field Lines EP',          'Tech House',    124, '8A',  '6:42', 7,  2024, 4.5, ['warmup','peak']],
  ['Velvet Hours',           'Kira Soto',              'Late Sets Vol. 2',        'Deep House',    122, '4A',  '7:18', 6,  2023, 4.0, ['warmup']],
  ['Salt Air Mix',           'Atlas Ova',              'Coastline',               'Deep House',    120, '3A',  '6:55', 5,  2022, 3.5, ['vocal']],
  ['Lowtide',                'Eli Brun',               'Submerged',               'Deep House',    118, '5A',  '7:04', 4,  2024, 4.5, ['ambient','intro']],
  ['Pressure Drop',          'NUMA',                   'Pressure Drop',           'Tech House',    126, '9A',  '6:12', 8,  2025, 5.0, ['peak','energy']],
  ['Foxglove',               'Renne Marais',           'Bloom',                   'Melodic House', 122, '11A', '8:20', 6,  2024, 4.5, ['melodic','vocal']],
  ['Talk Less',              'Soraya Vey',             'Single',                  'Tech House',    125, '7A',  '5:48', 7,  2025, 4.0, ['vocal','peak']],
  ['Crosswire',              'BUNT.E',                 'Wires',                   'Tech House',    127, '6A',  '6:32', 8,  2023, 4.5, ['peak']],
  ['Glasshouse',             'Yves Carre',             'Glasshouse',              'Progressive',   123, '10A', '8:55', 7,  2024, 5.0, ['melodic']],
  ['Slowburn',               'Loa Pereira',            'Slowburn',                'Deep House',    121, '2A',  '7:42', 5,  2022, 4.0, ['vocal']],
  // Techno
  ['Outer Belt',             'Halun',                  'Field Lines EP',          'Techno',        132, '9A',  '6:48', 9,  2024, 5.0, ['peak','energy']],
  ['Iron Garden',            'KVRN',                   'Iron Garden',             'Techno',        134, '11A', '7:12', 9,  2025, 4.5, ['peak']],
  ['Concrete Light',          'Mira Dell',              'Concrete Light',          'Techno',        130, '8A',  '7:55', 8,  2024, 4.0, ['warmup']],
  ['Hex Engine',             'Trace Element',          'Hex Engine',              'Techno',        135, '12A', '8:14', 10, 2025, 5.0, ['peak','closer']],
  ['Pylon',                  'KVRN',                   'Pylon',                   'Techno',        128, '7A',  '6:20', 7,  2023, 3.5, []],
  ['Nightframe',             'Aza Murai',              'Tunnel Sessions',         'Melodic Techno',124, '5A',  '8:42', 7,  2024, 4.5, ['melodic']],
  ['Steel Forest',           'Halun',                  'Steel Forest',            'Techno',        133, '10A', '7:32', 9,  2025, 4.5, ['peak']],
  ['Cathode Bloom',          'Trace Element',          'Cathode Bloom EP',        'Melodic Techno',122, '4A',  '9:08', 6,  2023, 4.0, ['melodic','intro']],
  // Drum & Bass / Breaks
  ['Run the Tape',           'Iso Kade',               'Tape Runners',            'Drum & Bass',   174, '6B',  '4:48', 9,  2024, 4.5, ['peak']],
  ['Half Mast',              'Reya Ohm',               'Half Mast',               'Liquid DnB',    172, '4B',  '5:32', 6,  2023, 4.0, ['vocal']],
  ['Cluster',                'Iso Kade',               'Cluster EP',              'Drum & Bass',   176, '8B',  '5:12', 9,  2025, 5.0, ['peak','energy']],
  // Disco / Nu-disco
  ['Sunset Boulevard 02:14', 'Marais & Co.',           'Late Bloomer',            'Nu-Disco',      118, '3B',  '6:15', 5,  2022, 4.0, ['vocal']],
  ['Sequins',                'The Plats',              'Sequins / Slow Glow',     'Disco',         115, '7B',  '7:24', 4,  2021, 3.5, ['vocal']],
  ['Long Way Down',          'Henra',                  'Long Way Down',           'Nu-Disco',      120, '9B',  '6:48', 6,  2024, 4.5, ['vocal']],
  // Hip-hop / R&B
  ['South of Broadway',      'Marcus Vey',             'South of Broadway',       'Hip-Hop',       92,  '5A',  '3:42', 6,  2024, 4.5, ['vocal']],
  ['Backseat Smoke',         'Lola Sin',               'Driving North',           'R&B',           88,  '2A',  '4:08', 5,  2023, 4.0, ['vocal','intro']],
  ['Hover',                  'KAI Ngata',              'Hover',                   'Hip-Hop',       96,  '11A', '3:24', 7,  2025, 4.5, ['vocal']],
  // Garage / UKG
  ['Two-Step Sunday',        'Boroh',                  'Two-Step Sunday',         'UK Garage',     132, '5B',  '5:48', 7,  2024, 4.5, ['vocal']],
  ['Channels',               'Tess Ade',               'Channels',                'UK Garage',     134, '8B',  '6:02', 7,  2023, 4.0, []],
  // Afro / Latin
  ['Lago Azul',              'Calida',                 'Lago Azul',               'Afro House',    122, '11B', '7:42', 7,  2024, 4.5, ['vocal','peak']],
  ['Cumulus',                'Joon Ek',                'Migratory',               'Afro House',    121, '6B',  '8:32', 6,  2023, 4.5, []],
  ['Saudade',                'Loa Pereira',            'Saudade',                 'Latin House',   123, '10B', '7:08', 7,  2025, 5.0, ['vocal','peak']],
  // Ambient / Intro tools
  ['Open Field',             'Aza Murai',              'Tools Vol. 1',            'Ambient',       0,   '4A',  '4:12', 2,  2022, 3.0, ['ambient','intro']],
  ['Static Bloom',           'Eli Brun',               'Tools Vol. 1',            'Ambient',       0,   '7A',  '3:48', 1,  2022, 3.0, ['ambient','intro']],
  // Edits / bootlegs (your own work)
  ['Hover (Playcircle Edit)','KAI Ngata',              'Edits',                   'Hip-Hop',       124, '11A', '4:42', 7,  2025, 5.0, ['edit','vocal']],
  ['Foxglove (Tunnel Mix)',  'Renne Marais',           'Edits',                   'Melodic House', 126, '11A', '6:48', 8,  2025, 5.0, ['edit','peak']],
  ['Magnetic North (Dub)',   'Halun',                  'Edits',                   'Tech House',    124, '8A',  '5:42', 7,  2025, 4.5, ['edit']],
  ['Two-Step Sunday (VIP)',  'Boroh',                  'Edits',                   'UK Garage',     130, '5B',  '5:18', 8,  2025, 4.5, ['edit','vocal']],
  // Older gold
  ['Lantern',                'Marais & Co.',           'Late Bloomer',            'Nu-Disco',      117, '12B', '7:08', 5,  2021, 4.0, ['vocal']],
  ['Driftcard',              'Mira Dell',              'Driftcard',               'Melodic Techno',120, '3A',  '8:48', 6,  2022, 4.0, ['melodic']],
];

function fmtAddedDate(year, idx) {
  const month = ((idx * 7) % 12) + 1;
  const day = ((idx * 11) % 27) + 1;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

const TRACKS = RAW_TRACKS.map((row, i) => {
  const [title, artist, album, genre, bpm, key, duration, energy, year, rating, tags] = row;
  // Cue points (in seconds, approximate)
  const [m, s] = duration.split(':').map(Number);
  const totalSec = m * 60 + s;
  const cues = bpm > 0 ? [
    { id: 1, label: 'Intro',   pos: 0,                   color: '#4ea892' },
    { id: 2, label: 'Build',   pos: totalSec * 0.22,     color: '#c99a3d' },
    { id: 3, label: 'Drop',    pos: totalSec * 0.32,     color: '#c95a72' },
    { id: 4, label: 'Break',   pos: totalSec * 0.55,     color: '#8e72c2' },
    { id: 5, label: 'Drop 2',  pos: totalSec * 0.66,     color: '#c95a72' },
    { id: 6, label: 'Outro',   pos: totalSec * 0.88,     color: '#5b5e67' },
  ] : [];

  return {
    id: 'tr_' + (i + 1),
    title, artist, album, genre,
    bpm, key, duration, totalSec,
    energy, year, rating, tags,
    added: fmtAddedDate(year, i),
    plays: ((i * 13) % 28),
    bitrate: 320,
    fileType: i % 9 === 0 ? 'AIFF' : (i % 5 === 0 ? 'FLAC' : 'MP3'),
    filePath: null,
    fileSize: (totalSec * 0.04 + (i % 5)).toFixed(1) + ' MB',
    waveform: makeWaveform(i * 137 + 7, 256),
    energyCurve: makeEnergyCurve(i * 91 + 13),
    cues,
    analyzed: i % 17 !== 5, // most analyzed
  };
});

const CRATES = [
  { id: 'cr_1', name: 'Friday — Outpost',     count: 18, color: '#c99a3d', updated: '2 days ago' },
  { id: 'cr_2', name: 'Sunday Brunch',        count: 32, color: '#4ea892', updated: '5 days ago' },
  { id: 'cr_3', name: 'After-hours / 5am',    count: 24, color: '#8e72c2', updated: '3 weeks ago' },
  { id: 'cr_4', name: 'Festival Mainstage',   count: 41, color: '#c95a72', updated: '1 month ago' },
  { id: 'cr_5', name: 'Sandbox / WIP',        count:  9, color: '#5b5e67', updated: 'today' },
];

const PLAYLISTS = [
  { id: 'pl_1', name: 'New This Month',  count: 14, trackIds: TRACKS.slice(0, 14).map((track) => track.id), isFolder: false, children: [] },
  { id: 'pl_2', name: 'Edits & VIPs',    count:  8, trackIds: TRACKS.slice(6, 14).map((track) => track.id), isFolder: false, children: [] },
  { id: 'pl_3', name: 'Tested in Club',  count: 27, trackIds: TRACKS.slice(10, 37).map((track) => track.id), isFolder: false, children: [] },
  { id: 'pl_4', name: 'Closers',         count: 11, trackIds: TRACKS.slice(20, 31).map((track) => track.id), isFolder: false, children: [] },
];

const SMART = [
  { id: 'sm_1', name: '5★ tracks',        count: 12, rule: 'rating = 5' },
  { id: 'sm_2', name: 'Unanalyzed',       count:  3, rule: 'analyzed = false' },
  { id: 'sm_3', name: '120–126 BPM, A',   count: 11, rule: 'bpm 120–126 / minor' },
  { id: 'sm_4', name: 'Played < 5x',      count: 19, rule: 'plays < 5' },
];

const TAGS = [
  { id: 'tg_warmup',  label: 'warmup',  color: '#4ea892' },
  { id: 'tg_peak',    label: 'peak',    color: '#c95a72' },
  { id: 'tg_energy',  label: 'energy',  color: '#c99a3d' },
  { id: 'tg_vocal',   label: 'vocal',   color: '#8e72c2' },
  { id: 'tg_intro',   label: 'intro',   color: '#3e8fae' },
  { id: 'tg_ambient', label: 'ambient', color: '#3a8a78' },
  { id: 'tg_melodic', label: 'melodic', color: '#aeb845' },
  { id: 'tg_closer',  label: 'closer',  color: '#bf72a3' },
  { id: 'tg_edit',    label: 'edit',    color: '#cdb46a' },
];

const DEVICES = [
  { id: 'dv_1', name: 'PIONEER 32GB',   kind: 'usb',  used: 18.4, total: 32, status: 'syncing' },
  { id: 'dv_2', name: 'TOUR DRIVE',     kind: 'usb',  used: 142,  total: 256, status: 'mounted' },
];

// Camelot compatibility: same key, same letter ±1, opposite letter same number
function compatibleKeys(key) {
  if (!key) return new Set();
  const num = parseInt(key);
  const letter = key.slice(-1);
  const opp = letter === 'A' ? 'B' : 'A';
  const wrap = (n) => ((n - 1 + 12) % 12) + 1;
  return new Set([
    `${num}${letter}`,
    `${wrap(num + 1)}${letter}`,
    `${wrap(num - 1)}${letter}`,
    `${num}${opp}`,
  ]);
}

function bpmCompat(a, b) {
  if (!a || !b) return 'none';
  const diff = Math.abs(a - b);
  const ratio = Math.min(a, b) / Math.max(a, b);
  if (diff <= 1) return 'perfect';
  if (diff <= 4) return 'close';
  if (ratio > 0.93) return 'workable';
  // half-time / double-time
  if (Math.abs(a - b * 2) <= 4 || Math.abs(b - a * 2) <= 4) return 'workable';
  return 'far';
}

window.PC_DATA = {
  TRACKS, CRATES, PLAYLISTS, SMART, TAGS, DEVICES,
  CAMELOT_COLORS, CAMELOT_ORDER,
  compatibleKeys, bpmCompat,
};
