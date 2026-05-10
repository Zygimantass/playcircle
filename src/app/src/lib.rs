use std::path::PathBuf;
use std::sync::Mutex;

use playcircle_audio::{AudioEngine, DeckId};
use playcircle_rekordbox::{RekordboxBeat, RekordboxDatabase, RekordboxLibrary, RekordboxTrack};

struct AudioEngineState(Mutex<Option<AudioEngine>>);

#[tauri::command]
fn load_rekordbox_tracks(path: Option<String>) -> Result<Vec<RekordboxTrack>, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let db = RekordboxDatabase::open(&db_path)
        .map_err(|error| format!("failed to open {}: {error}", db_path.display()))?;

    db.read_tracks()
        .map_err(|error| format!("failed to read tracks from {}: {error}", db_path.display()))
}

#[tauri::command]
fn load_rekordbox_library(path: Option<String>) -> Result<RekordboxLibrary, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let db = RekordboxDatabase::open(&db_path)
        .map_err(|error| format!("failed to open {}: {error}", db_path.display()))?;

    db.read_library()
        .map_err(|error| format!("failed to read library from {}: {error}", db_path.display()))
}

#[tauri::command]
fn load_rekordbox_beat_grid(
    path: Option<String>,
    analysis_data_path: String,
) -> Result<Vec<RekordboxBeat>, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let db = RekordboxDatabase::open(&db_path)
        .map_err(|error| format!("failed to open {}: {error}", db_path.display()))?;

    Ok(db.read_beat_grid(&analysis_data_path))
}

fn default_demo_database_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../playcircle-rekordbox-demo/master.db")
}

#[tauri::command]
fn load_audio_deck(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    path: String,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.load_deck(DeckId::from_label(&deck)?, PathBuf::from(path))
    })
}

#[tauri::command]
fn play_audio_deck(state: tauri::State<'_, AudioEngineState>, deck: String) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.play_deck(DeckId::from_label(&deck)?)
    })
}

#[tauri::command]
fn pause_audio_deck(state: tauri::State<'_, AudioEngineState>, deck: String) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.pause_deck(DeckId::from_label(&deck)?)
    })
}

#[tauri::command]
fn seek_audio_deck(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    position: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.seek_deck(DeckId::from_label(&deck)?, position)
    })
}

#[tauri::command]
fn set_audio_deck_volume(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    volume: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_volume(DeckId::from_label(&deck)?, volume)
    })
}

#[tauri::command]
fn set_audio_deck_filter(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    cutoff_hz: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_filter(DeckId::from_label(&deck)?, cutoff_hz)
    })
}

#[tauri::command]
fn set_audio_deck_cue(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    enabled: bool,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_cue(DeckId::from_label(&deck)?, enabled)
    })
}

#[tauri::command]
fn set_audio_master_volume(
    state: tauri::State<'_, AudioEngineState>,
    volume: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| engine.set_master_volume(volume))
}

#[tauri::command]
fn audio_deck_position(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<f32, String> {
    with_audio_engine(&state, |engine| {
        engine.deck_position(DeckId::from_label(&deck)?)
    })
}

fn with_audio_engine<T>(
    state: &tauri::State<'_, AudioEngineState>,
    action: impl FnOnce(&AudioEngine) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "audio engine state lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(AudioEngine::new()?);
    }
    action(guard.as_ref().expect("audio engine initialized"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioEngineState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_rekordbox_tracks,
            load_rekordbox_library,
            load_rekordbox_beat_grid,
            load_audio_deck,
            play_audio_deck,
            pause_audio_deck,
            seek_audio_deck,
            set_audio_deck_volume,
            set_audio_deck_filter,
            set_audio_deck_cue,
            set_audio_master_volume,
            audio_deck_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running Playcircle");
}
