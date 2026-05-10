use std::path::PathBuf;
use std::time::Instant;

use playcircle_audio::decoder::decode_file;

const TARGET_SAMPLE_RATE: u32 = 44_100;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let paths = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Err("usage: cargo run -p playcircle-audio --example decode_perf -- <audio-file> [audio-file...]".into());
    }

    let mut results = Vec::new();
    for path in paths {
        let metadata = std::fs::metadata(&path)?;
        let started_at = Instant::now();
        let frames = decode_file(&path, TARGET_SAMPLE_RATE)
            .map_err(|error| format!("failed to decode {}: {error}", path.display()))?;
        let decode_ms = started_at.elapsed().as_secs_f64() * 1000.0;
        let audio_seconds = frames.len() as f64 / TARGET_SAMPLE_RATE as f64;
        let realtime_factor = if decode_ms > 0.0 {
            audio_seconds / (decode_ms / 1000.0)
        } else {
            0.0
        };
        let mb_per_second = if decode_ms > 0.0 {
            metadata.len() as f64 / 1_000_000.0 / (decode_ms / 1000.0)
        } else {
            0.0
        };

        results.push(format!(
            "{{\"path\":{},\"fileSizeBytes\":{},\"frames\":{},\"audioSeconds\":{},\"decodeMs\":{},\"realtimeFactor\":{},\"mbPerSecond\":{}}}",
            json_string(&path.to_string_lossy()),
            metadata.len(),
            frames.len(),
            number(audio_seconds),
            number(decode_ms),
            number(realtime_factor),
            number(mb_per_second)
        ));
    }

    println!("[{}]", results.join(","));

    Ok(())
}

fn number(value: f64) -> String {
    format!("{value:.3}")
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
