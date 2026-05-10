use std::path::PathBuf;
use std::time::{Duration, Instant};

use playcircle_audio::{AudioEngine, DeckId};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os().nth(1).map(PathBuf::from).ok_or(
        "usage: cargo run -p playcircle-audio --example load_playback_perf -- <audio-file>",
    )?;
    let metadata = std::fs::metadata(&path)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    let started_at = Instant::now();

    let engine_started_at = Instant::now();
    let engine = AudioEngine::new().map_err(|error| format!("engine init failed: {error}"))?;
    let engine_init_ms = engine_started_at.elapsed().as_secs_f64() * 1000.0;

    engine
        .set_master_volume(0.0)
        .map_err(|error| format!("master mute failed: {error}"))?;

    let load_started_at = Instant::now();
    engine
        .load_deck(DeckId::A, &path)
        .map_err(|error| format!("deck load failed: {error}"))?;
    let load_ms = load_started_at.elapsed().as_secs_f64() * 1000.0;

    let play_started_at = Instant::now();
    engine
        .play_deck(DeckId::A)
        .map_err(|error| format!("deck play failed: {error}"))?;
    let play_command_ms = play_started_at.elapsed().as_secs_f64() * 1000.0;
    let total_to_play_command_ms = started_at.elapsed().as_secs_f64() * 1000.0;

    std::thread::sleep(Duration::from_millis(120));
    let position_after_120ms = engine.deck_position(DeckId::A).unwrap_or(0.0);

    let blocking_load_started_at = Instant::now();
    engine
        .load_deck_blocking(DeckId::B, &path)
        .map_err(|error| format!("blocking deck load failed: {error}"))?;
    let blocking_load_ms = blocking_load_started_at.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{{\"path\":{},\"extension\":{},\"fileSizeBytes\":{},\"engineInitMs\":{},\"streamingLoadMs\":{},\"blockingFullDecodeLoadMs\":{},\"playCommandMs\":{},\"totalToPlayCommandMs\":{},\"positionAfter120Ms\":{}}}",
        json_string(&path.to_string_lossy()),
        json_string(extension),
        metadata.len(),
        number(engine_init_ms),
        number(load_ms),
        number(blocking_load_ms),
        number(play_command_ms),
        number(total_to_play_command_ms),
        precise_number(position_after_120ms as f64)
    );

    Ok(())
}

fn number(value: f64) -> String {
    format!("{value:.3}")
}

fn precise_number(value: f64) -> String {
    format!("{value:.6}")
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
