# Playcircle PRD

## Product Direction

Playcircle is an open-source, macOS-first DJ practice and preparation app. It should replace the parts of Rekordbox that matter for local practice first: library browsing, playlist prep, deck playback, hot cues, waveform interaction, DDJ-FLX4 control, basic FX, and recording.

CDJ-3000 export remains a future compatibility project. The app should preserve the right internal concepts for future export, but v1 should not be shaped around reverse-engineering CDJ media.

## Current Baseline

The current app is a Tauri v2 desktop application with a React + TypeScript frontend and Rust backend crates. It can read a Rekordbox SQLCipher database, map tracks and playlists into the frontend library model, and play tracks through the Rust audio engine. Rekordbox writes are not implemented yet: playlist and crate interactions in the UI are currently either read-only or local frontend state.

Relevant existing architecture:

- `src/rekordbox`: Rust Rekordbox database access. Opens the database read-only today and reads `djmdContent`, `djmdPlaylist`, and `djmdSongPlaylist`.
- `src/app`: Tauri command layer that exposes library and audio operations to the frontend.
- `src/frontend`: React UI for the library, decks, mixer, waveforms, and browser mappings.
- `src/audio`: Rust playback, deck state, meters, filters, EQ, and output handling.

## Library Management Editing PRD

### Problem

Playcircle can browse the Rekordbox library but cannot yet persist preparation work. The first useful editing workflow is playlist management: create a playlist from Playcircle and add existing Rekordbox tracks to it, with the result written back to the Rekordbox database so Rekordbox can see the changes.

### Goals

- Let users create Rekordbox playlists from Playcircle.
- Let users add one or more existing library tracks to a Rekordbox playlist.
- Persist those changes to the Rekordbox database, not only local UI state.
- Keep database writes transactional, recoverable, and guarded against avoidable corruption.
- Make the implementation testable against copied databases before enabling writes to a real user database.

### Non-Goals

- Importing new audio files into Rekordbox.
- Editing track metadata, beat grids, cue points, analysis data, or artwork.
- Deleting playlists, renaming playlists, reordering playlists, or removing tracks from playlists.
- Playlist folders, smart playlists, CDJ export, or full Rekordbox sync behavior.
- Writing while Rekordbox itself is actively using the same database.

### Phase 1 User Stories

- As a DJ, I can create a new playlist under the root playlist area.
- As a DJ, I can drag a track from the library onto a playlist and have it added there.
- As a DJ, I can select multiple tracks and add them to a playlist in their current sort order.
- As a DJ, I can restart Playcircle and see the created playlist and added tracks still present.
- As a DJ, I can open Rekordbox afterward and see the playlist changes there.

### Functional Requirements

1. Edit mode
   - Playlist writes must be disabled by default until the app has opened a writable database path.
   - The UI must clearly distinguish read-only Rekordbox browsing from editable Rekordbox mode.
   - Browser/demo fixture mode must either disable persistence controls or use explicit in-memory mock behavior.

2. Database safety
   - Before the first write in a session, Playcircle must create a timestamped backup copy of the Rekordbox database.
   - If backup creation fails, writes must remain disabled.
   - Writes must run in a single transaction and fail atomically.
   - The app must detect common unsafe states, especially Rekordbox running or the DB being locked, and block writes with a clear error.

3. Create playlist
   - Users can create a playlist with a non-empty name.
   - The first version creates regular playlists only, not folders.
   - The playlist should be inserted at the end of the root playlist list unless a parent is explicitly provided later.
   - Duplicate names should be allowed only if Rekordbox allows them safely; otherwise the UI should prevent duplicates within the same parent.
   - After creation, the frontend should refresh from the database and select the new playlist.

4. Add tracks to playlist
   - Users can add one track by dragging it onto a playlist.
   - Users can add multiple selected tracks via drag/drop or an add-to-playlist command.
   - Tracks should be appended after the playlist's current last position.
   - Existing tracks in the playlist should be skipped by default to avoid accidental duplicates.
   - Invalid track IDs or playlist IDs must fail without partial writes.

5. Refresh and consistency
   - After each mutation, Playcircle should reload the affected playlist data from the database.
   - The frontend should not assume success from optimistic local state alone.
   - Errors must leave the UI in sync with the last confirmed database state.

### UX Requirements

- Add a playlist create control in the library sidebar.
- Support drag/drop from track rows onto playlist rows.
- Support a context-menu or toolbar action for adding selected tracks to a playlist.
- Show lightweight success/error feedback after writes.
- Disable playlist edit actions while a write is in progress.
- Avoid destructive controls in Phase 1; playlist deletion and removal can follow once writes are proven.

### Technical Requirements

1. Rekordbox write API
   - Add an explicit read-write opening path in `src/rekordbox`.
   - Keep the existing read-only path for normal browsing.
   - Add methods similar to:
     - `create_playlist(parent_id: Option<String>, name: String) -> RekordboxPlaylist`
     - `add_tracks_to_playlist(playlist_id: String, track_ids: Vec<String>) -> RekordboxPlaylist`

2. Tauri commands
   - Expose playlist write commands from `src/app`.
   - Commands must return typed DTOs or a refreshed library slice, not loosely shaped JSON.
   - Command errors should preserve enough detail for the frontend to show actionable messages.

3. Frontend API
   - Add typed wrappers in `src/frontend/api`.
   - Wire create playlist and add-to-playlist flows through the existing library state.
   - Keep browser fixture behavior separate from real Rekordbox mutation behavior.

4. Database implementation
   - Use `BEGIN IMMEDIATE` or equivalent transactional locking for writes.
   - Insert into `djmdPlaylist` and `djmdSongPlaylist` only after verifying the exact schema and required default columns from the target Rekordbox database.
   - Generate IDs, UUIDs, timestamps, sequence values, and track numbers in the same shape Rekordbox expects.
   - Do not infer write columns from the current read queries alone; inspect `PRAGMA table_info` and test against a database copy.

### Testing Requirements

- Rust integration tests must run against a temporary copy of a Rekordbox fixture database.
- Tests must verify:
  - creating a playlist persists after reopening the database;
  - adding one track persists with the expected order;
  - adding multiple tracks preserves requested order;
  - duplicate additions are skipped or reported according to the chosen behavior;
  - invalid playlist IDs and track IDs do not partially write;
  - backup failure blocks writes.
- Frontend tests should cover:
  - create playlist UI state;
  - drag/drop track to playlist;
  - disabled controls in read-only mode;
  - visible error handling on command failure.
- A manual acceptance test must confirm that Rekordbox can open the modified copied database and display the new playlist.

### Acceptance Criteria

- From Playcircle, create a playlist named `Playcircle Test`.
- Add at least three existing tracks to it.
- Quit and reopen Playcircle; the playlist and tracks are still present.
- Open Rekordbox against the same test database; the playlist and tracks are visible.
- No writes occur unless a backup was created first.
- A failed add operation leaves the playlist unchanged.

### Rollout Plan

1. Add schema inspection and fixture-copy integration tests.
2. Implement read-write Rekordbox database opening behind an explicit edit-mode path.
3. Implement `create_playlist` in Rust and expose it through Tauri.
4. Implement `add_tracks_to_playlist` in Rust and expose it through Tauri.
5. Wire frontend create playlist and drag/drop add flows.
6. Add Playwright coverage for the editable library workflow.
7. Run manual validation on a disposable Rekordbox database copy before enabling writes for normal use.

### Open Questions

- Should duplicate track membership be impossible, or should Playcircle match Rekordbox if it permits duplicate playlist entries?
- Should Phase 1 support creating playlists inside existing folders, or only root-level playlists?
- What is the safest cross-version strategy for Rekordbox `ID`, `UUID`, `Seq`, `TrackNo`, timestamp, and sync metadata fields?
- Should Playcircle write directly to the live Rekordbox database, or should it maintain a copied editable library until explicit sync?
- What exact detection should block concurrent Rekordbox usage: process detection, SQLite locking, Rekordbox lock files, or all of these?

## Future MVP Scope

- Local music file import by reference.
- Playlist rename, reorder, delete, and remove-track operations.
- Two-deck playback.
- DDJ-FLX4 core controller support.
- Waveform display with scrub interaction.
- BPM detection and beatgrid storage.
- Hot cue set, delete, display, and trigger.
- Basic mixer with gain, EQ, channel faders, and crossfader.
- Echo and reverb.
- Master output recording to WAV.
- M3U playlist import/export.
