import { invoke } from "@tauri-apps/api/core";

export type RekordboxBeatDto = {
  time_seconds: number;
  beat_number: number;
  bpm: number | null;
};

export type RekordboxTrackDto = {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  key: string | null;
  color: string | null;
  bpm: number | null;
  length_seconds: number | null;
  track_number: number | null;
  bitrate: number | null;
  bit_depth: number | null;
  sample_rate: number | null;
  comments: string | null;
  file_type: number | null;
  file_type_name: string | null;
  rating: number | null;
  release_year: number | null;
  play_count: number | null;
  file_name: string | null;
  folder_path: string | null;
  file_path: string | null;
  file_size: number | null;
  analysis_data_path: string | null;
  beat_grid?: RekordboxBeatDto[];
  analyzed: boolean;
  date_created: string | null;
  updated_at: string | null;
  uuid: string | null;
};

export type RekordboxPlaylistDto = {
  id: string;
  name: string;
  parent_id: string | null;
  sequence: number | null;
  attribute: number | null;
  is_folder: boolean;
  track_ids: string[];
  uuid: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RekordboxLibraryDto = {
  tracks: RekordboxTrackDto[];
  playlists: RekordboxPlaylistDto[];
};

export function loadRekordboxTracks(path?: string) {
  return loadRekordboxLibrary(path).then((library) => library.tracks);
}

export function loadRekordboxLibrary(path?: string) {
  if (shouldUseBrowserFixture()) {
    return fetch("/rekordbox-demo-tracks.json").then((response) => {
      if (!response.ok) {
        throw new Error(`failed to load rekordbox fixture: ${response.status}`);
      }
      return response.json() as Promise<RekordboxLibraryDto>;
    });
  }

  return invoke<RekordboxLibraryDto>("load_rekordbox_library", { path });
}

export function createRekordboxPlaylist(name: string, parentId?: string | null, path?: string) {
  if (shouldUseBrowserFixture()) {
    return Promise.reject(new Error("Rekordbox fixture mode is read-only"));
  }

  return invoke<RekordboxPlaylistDto>("create_rekordbox_playlist", {
    path,
    parentId: parentId ?? null,
    name
  });
}

export function addRekordboxTracksToPlaylist(playlistId: string, trackIds: string[], path?: string) {
  if (shouldUseBrowserFixture()) {
    return Promise.reject(new Error("Rekordbox fixture mode is read-only"));
  }

  return invoke<RekordboxPlaylistDto>("add_rekordbox_tracks_to_playlist", {
    path,
    playlistId,
    trackIds
  });
}

export function loadRekordboxBeatGrid(analysisDataPath: string, path?: string) {
  if (shouldUseBrowserFixture()) return Promise.resolve<RekordboxBeatDto[]>([]);

  return invoke<RekordboxBeatDto[]>("load_rekordbox_beat_grid", { path, analysisDataPath });
}

function shouldUseBrowserFixture() {
  return new URLSearchParams(window.location.search).get("fixture") === "rekordbox";
}
