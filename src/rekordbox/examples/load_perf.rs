use std::path::PathBuf;
use std::time::Instant;

use playcircle_rekordbox::{RekordboxDatabase, RekordboxLibrary};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../playcircle-rekordbox-demo/master.db")
        });

    let total_started_at = Instant::now();

    let open_started_at = Instant::now();
    let db = RekordboxDatabase::open(&db_path)?;
    let open_ms = elapsed_ms(open_started_at);

    let tracks_started_at = Instant::now();
    let tracks = db.read_tracks()?;
    let read_tracks_ms = elapsed_ms(tracks_started_at);

    let playlists_started_at = Instant::now();
    let playlists = db.read_playlists()?;
    let read_playlists_ms = elapsed_ms(playlists_started_at);

    let library = RekordboxLibrary { tracks, playlists };

    let serialize_started_at = Instant::now();
    let payload = serde_json::to_vec(&library)?;
    let serialize_ms = elapsed_ms(serialize_started_at);

    let total_ms = elapsed_ms(total_started_at);
    let beat_grid_count: usize = library
        .tracks
        .iter()
        .map(|track| track.beat_grid.len())
        .sum();

    println!(
        "{{\"dbPath\":{},\"trackCount\":{},\"playlistCount\":{},\"beatGridCount\":{},\"payloadBytes\":{},\"openMs\":{},\"readTracksMs\":{},\"readPlaylistsMs\":{},\"serializeMs\":{},\"totalMs\":{}}}",
        json_string(&db_path.to_string_lossy()),
        library.tracks.len(),
        library.playlists.len(),
        beat_grid_count,
        payload.len(),
        number(open_ms),
        number(read_tracks_ms),
        number(read_playlists_ms),
        number(serialize_ms),
        number(total_ms)
    );

    Ok(())
}

fn elapsed_ms(started_at: Instant) -> f64 {
    started_at.elapsed().as_secs_f64() * 1000.0
}

fn number(value: f64) -> String {
    format!("{value:.3}")
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
