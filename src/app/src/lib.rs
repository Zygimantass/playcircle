use std::path::PathBuf;
use std::sync::Mutex;

use playcircle_audio::{
    decoder::decode_file, list_output_devices as list_audio_output_devices, AudioBeatGridMarker,
    AudioEngine, AudioOutputDevice, DeckFxConfig, DeckFxKind, DeckId,
};
use playcircle_controller::{ControllerDevice, ControllerEvent, ControllerManager};
use playcircle_rekordbox::{
    RekordboxBeat, RekordboxDatabase, RekordboxLibrary, RekordboxPlaylist, RekordboxTrack,
};
use serde::{Deserialize, Serialize};

struct AudioEngineState(Mutex<AudioEngineHandle>);
struct ControllerState(Mutex<ControllerManager>);

struct AudioEngineHandle {
    engine: Option<AudioEngine>,
    output_device_id: Option<String>,
    master_output_device_id: Option<String>,
}

impl AudioEngineHandle {
    fn new() -> Self {
        Self {
            engine: None,
            output_device_id: None,
            master_output_device_id: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioOutputDeviceDto {
    id: String,
    name: String,
    channels: u16,
    sample_rate: u32,
    cue_supported: bool,
    selected: bool,
    master_selected: bool,
}

impl From<AudioOutputDevice> for AudioOutputDeviceDto {
    fn from(device: AudioOutputDevice) -> Self {
        Self {
            id: device.id,
            name: device.name,
            channels: device.channels,
            sample_rate: device.sample_rate,
            cue_supported: device.cue_supported,
            selected: device.selected,
            master_selected: device.master_selected,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioBeatGridMarkerDto {
    time_seconds: f64,
    beat_number: i32,
}

impl From<AudioBeatGridMarkerDto> for AudioBeatGridMarker {
    fn from(marker: AudioBeatGridMarkerDto) -> Self {
        Self {
            time_seconds: marker.time_seconds,
            beat_number: marker.beat_number,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioDeckFxConfigDto {
    kind: AudioDeckFxKindDto,
    enabled: bool,
    mix: f32,
    amount: f32,
    rate_hz: f32,
    feedback: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum AudioDeckFxKindDto {
    Echo,
    Reverb,
    Crush,
    Flanger,
    Spiral,
    Delay,
    Trans,
    Phaser,
    Roll,
    SlipRoll,
}

impl From<AudioDeckFxKindDto> for DeckFxKind {
    fn from(kind: AudioDeckFxKindDto) -> Self {
        match kind {
            AudioDeckFxKindDto::Echo => DeckFxKind::Echo,
            AudioDeckFxKindDto::Reverb => DeckFxKind::Reverb,
            AudioDeckFxKindDto::Crush => DeckFxKind::Crush,
            AudioDeckFxKindDto::Flanger => DeckFxKind::Flanger,
            AudioDeckFxKindDto::Spiral => DeckFxKind::Spiral,
            AudioDeckFxKindDto::Delay => DeckFxKind::Delay,
            AudioDeckFxKindDto::Trans => DeckFxKind::Trans,
            AudioDeckFxKindDto::Phaser => DeckFxKind::Phaser,
            AudioDeckFxKindDto::Roll => DeckFxKind::Roll,
            AudioDeckFxKindDto::SlipRoll => DeckFxKind::SlipRoll,
        }
    }
}

impl From<AudioDeckFxConfigDto> for DeckFxConfig {
    fn from(effect: AudioDeckFxConfigDto) -> Self {
        Self {
            kind: effect.kind.into(),
            enabled: effect.enabled,
            mix: effect.mix,
            amount: effect.amount,
            rate_hz: effect.rate_hz,
            feedback: effect.feedback,
        }
    }
}

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
fn create_rekordbox_playlist(
    path: Option<String>,
    parent_id: Option<String>,
    name: String,
) -> Result<RekordboxPlaylist, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let mut db = RekordboxDatabase::open_read_write(&db_path)
        .map_err(|error| format!("failed to open {} for writing: {error}", db_path.display()))?;

    db.create_playlist(parent_id.as_deref(), &name)
        .map_err(|error| {
            format!(
                "failed to create playlist in {}: {error}",
                db_path.display()
            )
        })
}

#[tauri::command]
fn add_rekordbox_tracks_to_playlist(
    path: Option<String>,
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<RekordboxPlaylist, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let mut db = RekordboxDatabase::open_read_write(&db_path)
        .map_err(|error| format!("failed to open {} for writing: {error}", db_path.display()))?;

    db.add_tracks_to_playlist(&playlist_id, &track_ids)
        .map_err(|error| {
            format!(
                "failed to add tracks to playlist in {}: {error}",
                db_path.display()
            )
        })
}

#[tauri::command]
fn move_rekordbox_playlist_to_folder(
    path: Option<String>,
    playlist_id: String,
    folder_id: String,
) -> Result<RekordboxPlaylist, String> {
    let db_path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_demo_database_path);
    let mut db = RekordboxDatabase::open_read_write(&db_path)
        .map_err(|error| format!("failed to open {} for writing: {error}", db_path.display()))?;

    db.move_playlist_to_folder(&playlist_id, &folder_id)
        .map_err(|error| format!("failed to move playlist in {}: {error}", db_path.display()))
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
async fn load_audio_waveform(path: String, bins: Option<usize>) -> Result<Vec<(f32, f32)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bins = bins.unwrap_or(512).clamp(32, 4096);
        let frames = decode_file(PathBuf::from(&path).as_path(), 44_100)?;
        Ok(audio_waveform(&frames, bins))
    })
    .await
    .map_err(|error| format!("waveform task failed: {error}"))?
}

fn audio_waveform(frames: &[[f32; 2]], bins: usize) -> Vec<(f32, f32)> {
    if frames.is_empty() {
        return Vec::new();
    }

    let frames_per_bin = frames.len().div_ceil(bins).max(1);
    (0..bins)
        .map(|index| {
            let start = index * frames_per_bin;
            let end = ((index + 1) * frames_per_bin).min(frames.len());
            let chunk = &frames[start..end];
            if chunk.is_empty() {
                return (0.0, 0.0);
            }

            let mut peak = 0.0_f32;
            let mut sum = 0.0_f32;
            for frame in chunk {
                let sample = frame[0].abs().max(frame[1].abs());
                peak = peak.max(sample);
                sum += sample;
            }

            let average = sum / chunk.len() as f32;
            ((average * 1.8).clamp(0.0, 1.0), peak.clamp(0.0, 1.0))
        })
        .collect()
}

#[tauri::command]
fn list_audio_outputs(
    state: tauri::State<'_, AudioEngineState>,
) -> Result<Vec<AudioOutputDeviceDto>, String> {
    let selected_id = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "audio engine state lock poisoned".to_string())?;
        (
            guard.output_device_id.clone(),
            guard.master_output_device_id.clone(),
        )
    };
    list_audio_output_devices(selected_id.0.as_deref(), selected_id.1.as_deref())
        .map(|devices| devices.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn set_audio_output_device(
    state: tauri::State<'_, AudioEngineState>,
    id: String,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "audio engine state lock poisoned".to_string())?;
    let output_device_id = if id == "default" { None } else { Some(id) };
    let engine = AudioEngine::new_for_output_devices(
        output_device_id.as_deref(),
        guard.master_output_device_id.as_deref(),
    )?;
    guard.engine = Some(engine);
    guard.output_device_id = output_device_id;
    Ok(())
}

#[tauri::command]
fn set_audio_master_output_device(
    state: tauri::State<'_, AudioEngineState>,
    id: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "audio engine state lock poisoned".to_string())?;
    let master_output_device_id = id.filter(|value| value != "off");
    let engine = AudioEngine::new_for_output_devices(
        guard.output_device_id.as_deref(),
        master_output_device_id.as_deref(),
    )?;
    guard.engine = Some(engine);
    guard.master_output_device_id = master_output_device_id;
    Ok(())
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
fn start_audio_deck_scrub(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.start_deck_scrub(DeckId::from_label(&deck)?)
    })
}

#[tauri::command]
fn scrub_audio_deck_to_position(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    position: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.scrub_deck_to_position(DeckId::from_label(&deck)?, position)
    })
}

#[tauri::command]
fn end_audio_deck_scrub(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.end_deck_scrub(DeckId::from_label(&deck)?)
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
fn set_audio_deck_tempo(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    tempo_percent: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_tempo(DeckId::from_label(&deck)?, tempo_percent)
    })
}

#[tauri::command]
fn set_audio_deck_beat_sync(
    state: tauri::State<'_, AudioEngineState>,
    follower: String,
    master: String,
    enabled: bool,
    follower_bpm: f64,
    master_bpm: f64,
    follower_beat_grid: Vec<AudioBeatGridMarkerDto>,
    master_beat_grid: Vec<AudioBeatGridMarkerDto>,
) -> Result<(), String> {
    let follower_beat_grid = follower_beat_grid.into_iter().map(Into::into).collect();
    let master_beat_grid = master_beat_grid.into_iter().map(Into::into).collect();
    with_audio_engine(&state, |engine| {
        engine.set_deck_beat_sync(
            DeckId::from_label(&follower)?,
            DeckId::from_label(&master)?,
            enabled,
            follower_bpm,
            master_bpm,
            follower_beat_grid,
            master_beat_grid,
        )
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
fn set_audio_deck_filter_amount(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    amount: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_filter_amount(DeckId::from_label(&deck)?, amount)
    })
}

#[tauri::command]
fn set_audio_deck_eq(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    high: f32,
    mid: f32,
    low: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_deck_eq(DeckId::from_label(&deck)?, high, mid, low)
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
fn set_audio_deck_fx_chain(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
    effects: Vec<AudioDeckFxConfigDto>,
) -> Result<(), String> {
    let effects = effects.into_iter().map(DeckFxConfig::from).collect();
    with_audio_engine(&state, |engine| {
        engine.set_deck_fx_chain(DeckId::from_label(&deck)?, effects)
    })
}

#[tauri::command]
fn clear_audio_deck_fx(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.clear_deck_fx(DeckId::from_label(&deck)?)
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
fn set_audio_headphone_volume(
    state: tauri::State<'_, AudioEngineState>,
    volume: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| engine.set_headphone_volume(volume))
}

#[tauri::command]
fn set_audio_headphone_mix(
    state: tauri::State<'_, AudioEngineState>,
    mix: f32,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| engine.set_headphone_mix(mix))
}

#[tauri::command]
fn set_audio_output_routing(
    state: tauri::State<'_, AudioEngineState>,
    master_start: usize,
    headphone_start: usize,
) -> Result<(), String> {
    with_audio_engine(&state, |engine| {
        engine.set_output_routing(master_start, headphone_start)
    })
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

#[tauri::command]
fn audio_deck_error(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<Option<String>, String> {
    with_audio_engine(&state, |engine| {
        engine.deck_error(DeckId::from_label(&deck)?)
    })
}

#[tauri::command]
fn audio_deck_level_db(
    state: tauri::State<'_, AudioEngineState>,
    deck: String,
) -> Result<f32, String> {
    with_audio_engine(&state, |engine| {
        engine.deck_level_db(DeckId::from_label(&deck)?)
    })
}

#[tauri::command]
fn list_controllers(
    state: tauri::State<'_, ControllerState>,
) -> Result<Vec<ControllerDevice>, String> {
    let manager = state
        .0
        .lock()
        .map_err(|_| "controller state lock poisoned".to_string())?;
    manager.list_devices()
}

#[tauri::command]
fn connect_controller(
    state: tauri::State<'_, ControllerState>,
    id: String,
) -> Result<ControllerDevice, String> {
    let mut manager = state
        .0
        .lock()
        .map_err(|_| "controller state lock poisoned".to_string())?;
    manager.connect(&id)
}

#[tauri::command]
fn disconnect_controller(state: tauri::State<'_, ControllerState>) -> Result<(), String> {
    let mut manager = state
        .0
        .lock()
        .map_err(|_| "controller state lock poisoned".to_string())?;
    manager.disconnect();
    Ok(())
}

#[tauri::command]
fn poll_controller_events(
    state: tauri::State<'_, ControllerState>,
) -> Result<Vec<ControllerEvent>, String> {
    let mut manager = state
        .0
        .lock()
        .map_err(|_| "controller state lock poisoned".to_string())?;
    Ok(manager.poll_events())
}

#[tauri::command]
fn send_controller_midi(
    state: tauri::State<'_, ControllerState>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let mut manager = state
        .0
        .lock()
        .map_err(|_| "controller state lock poisoned".to_string())?;
    manager.send_midi(&bytes)
}

fn with_audio_engine<T>(
    state: &tauri::State<'_, AudioEngineState>,
    action: impl FnOnce(&AudioEngine) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "audio engine state lock poisoned".to_string())?;
    if guard.engine.is_none() {
        guard.engine = Some(AudioEngine::new_for_output_devices(
            guard.output_device_id.as_deref(),
            guard.master_output_device_id.as_deref(),
        )?);
    }
    action(guard.engine.as_ref().expect("audio engine initialized"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioEngineState(Mutex::new(AudioEngineHandle::new())))
        .manage(ControllerState(Mutex::new(ControllerManager::new())))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_rekordbox_tracks,
            load_rekordbox_library,
            create_rekordbox_playlist,
            add_rekordbox_tracks_to_playlist,
            move_rekordbox_playlist_to_folder,
            load_rekordbox_beat_grid,
            load_audio_waveform,
            list_audio_outputs,
            set_audio_output_device,
            set_audio_master_output_device,
            load_audio_deck,
            play_audio_deck,
            pause_audio_deck,
            seek_audio_deck,
            start_audio_deck_scrub,
            scrub_audio_deck_to_position,
            end_audio_deck_scrub,
            set_audio_deck_volume,
            set_audio_deck_tempo,
            set_audio_deck_beat_sync,
            set_audio_deck_filter,
            set_audio_deck_filter_amount,
            set_audio_deck_eq,
            set_audio_deck_cue,
            set_audio_deck_fx_chain,
            clear_audio_deck_fx,
            set_audio_master_volume,
            set_audio_headphone_volume,
            set_audio_headphone_mix,
            set_audio_output_routing,
            audio_deck_position,
            audio_deck_error,
            audio_deck_level_db,
            list_controllers,
            connect_controller,
            disconnect_controller,
            poll_controller_events,
            send_controller_midi
        ])
        .run(tauri::generate_context!())
        .expect("error while running Playcircle");
}
