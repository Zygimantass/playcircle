# Playcircle PRD

## Product Direction

Playcircle is a private, macOS-first DJ practice and preparation app. It should replace the parts of Rekordbox that matter for local practice first: local library management, playlists, deck playback, hot cues, waveform interaction, DDJ-FLX4 control, basic FX, and recording.

CDJ-3000 export remains a future compatibility project. The app should preserve the right internal concepts for future export, but v1 should not be shaped around reverse-engineering CDJ media.

## MVP Scope

- Local music file import by reference.
- SQLite-backed library.
- Playlist creation, ordering, and deletion.
- Two-deck playback.
- DDJ-FLX4 core controller support.
- Waveform display with scrub interaction.
- BPM detection and basic beatgrid storage.
- Hot cue set, delete, display, and trigger.
- Basic mixer with gain, EQ, channel faders, and crossfader.
- Echo and reverb.
- Master output recording to WAV.
- M3U playlist import/export.

## Current Spike

The current implementation is a Tauri v2 + React + TypeScript interaction spike. It intentionally uses fake frontend data and no functional backend. The goal is to validate the UI shape, component boundaries, and interaction model before building the Rust engine.
