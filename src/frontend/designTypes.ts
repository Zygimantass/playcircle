export type Cue = {
  id: number;
  label: string;
  pos: number;
  color: string;
};

export type BeatGridMarker = {
  timeSec: number;
  beatNumber: number;
  bpm: number | null;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  bpm: number;
  key: string;
  duration: string;
  totalSec: number;
  energy: number;
  year: number;
  rating: number;
  tags: string[];
  added: string;
  plays: number;
  bitrate: number;
  fileType: string;
  filePath: string | null;
  analysisDataPath: string | null;
  fileSize: string;
  waveform: Array<[number, number]>;
  waveformSource?: "placeholder" | "audio";
  energyCurve: number[];
  cues: Cue[];
  beatGrid?: BeatGridMarker[];
  analyzed: boolean;
  sortKeys?: Record<string, string | number>;
};

export type SidebarEntry = {
  id: string;
  name: string;
  count: number;
  color?: string;
  used?: number;
  total?: number;
  status?: string;
};

export type PlaylistEntry = {
  id: string;
  name: string;
  count: number;
  trackIds: string[];
  isFolder: boolean;
  children: PlaylistEntry[];
};

export type TagEntry = {
  id: string;
  label: string;
  color: string;
};

export type PcData = {
  TRACKS: Track[];
  CRATES: SidebarEntry[];
  PLAYLISTS: PlaylistEntry[];
  SMART: SidebarEntry[];
  TAGS: TagEntry[];
  DEVICES: SidebarEntry[];
  CAMELOT_COLORS: Record<string, string>;
  CAMELOT_ORDER: string[];
  compatibleKeys: (key: string) => Set<string>;
  bpmCompat: (a: number, b: number) => "perfect" | "close" | "workable" | "far" | "none";
};

export type CurrentNode =
  | { type: "all" }
  | { type: "recent" }
  | { type: "fivestar" }
  | { type: "history" }
  | { type: "crate"; id: string }
  | { type: "playlist"; id: string }
  | { type: "smart"; id: string }
  | { type: "tag"; id: string };

export type SortableTrackKey = keyof Pick<
  Track,
  "title" | "artist" | "album" | "genre" | "bpm" | "key" | "duration" | "energy" | "rating" | "plays" | "added" | "fileType"
>;

export type SortState = {
  col: SortableTrackKey;
  dir: "asc" | "desc";
};
