use std::collections::VecDeque;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig, SupportedStreamConfig,
};

use crate::deck::{Deck, DeckFxConfig};
use crate::decoder::{decode_file, decode_file_to_sender, validate_file, DecodeMessage};

#[derive(Debug, Clone)]
pub struct AudioBeatGridMarker {
    pub time_seconds: f64,
    pub beat_number: i32,
}

#[derive(Debug, Clone)]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub sample_rate: u32,
    pub cue_supported: bool,
    pub selected: bool,
    pub master_selected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeckId {
    A,
    B,
}

impl DeckId {
    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "A" | "a" => Ok(Self::A),
            "B" | "b" => Ok(Self::B),
            _ => Err(format!("unknown deck {label}; expected A or B")),
        }
    }

    fn index(self) -> usize {
        match self {
            Self::A => 0,
            Self::B => 1,
        }
    }
}

pub struct AudioEngine {
    state: Arc<Mutex<MixerState>>,
    commands: Sender<AudioCommand>,
    shutdown: Sender<()>,
    sample_rate: u32,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        Self::new_for_output_device_id(None)
    }

    pub fn new_for_output_device_id(output_device_id: Option<&str>) -> Result<Self, String> {
        Self::new_for_output_devices(output_device_id, None)
    }

    pub fn new_for_output_devices(
        output_device_id: Option<&str>,
        master_output_device_id: Option<&str>,
    ) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = output_device(&host, output_device_id)?;
        let supported_config = preferred_output_config(&device)?;
        let sample_rate = supported_config.sample_rate().0;
        let channels = supported_config.channels() as usize;
        let state = Arc::new(Mutex::new(MixerState::new(sample_rate)));
        let master_tap = Arc::new(Mutex::new(MasterTap::new(sample_rate as usize)));
        let config = supported_config.config();
        let sample_format = supported_config.sample_format();
        let (command_sender, command_receiver) = mpsc::channel::<AudioCommand>();
        let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
        let (init_sender, init_receiver) = mpsc::channel::<Result<(), String>>();
        let thread_state = state.clone();
        let thread_master_tap = master_tap.clone();
        let master_output_device_id = master_output_device_id.map(str::to_string);

        thread::Builder::new()
            .name("playcircle-audio".to_string())
            .spawn(move || {
                let stream = match sample_format {
                    SampleFormat::F32 => build_stream::<f32>(
                        &device,
                        &config,
                        channels,
                        thread_state.clone(),
                        thread_master_tap.clone(),
                        command_receiver,
                    ),
                    SampleFormat::I16 => build_stream::<i16>(
                        &device,
                        &config,
                        channels,
                        thread_state.clone(),
                        thread_master_tap.clone(),
                        command_receiver,
                    ),
                    SampleFormat::U16 => build_stream::<u16>(
                        &device,
                        &config,
                        channels,
                        thread_state.clone(),
                        thread_master_tap.clone(),
                        command_receiver,
                    ),
                    sample_format => Err(format!(
                        "unsupported output sample format: {sample_format:?}"
                    )),
                };

                let stream = match stream {
                    Ok(stream) => stream,
                    Err(error) => {
                        let _ = init_sender.send(Err(error));
                        return;
                    }
                };

                if let Err(error) = stream.play() {
                    let _ =
                        init_sender.send(Err(format!("failed to start output stream: {error}")));
                    return;
                }

                let master_stream = match master_output_device_id.as_deref() {
                    Some(id) => match build_master_mirror_stream(id, thread_master_tap.clone()) {
                        Ok(stream) => Some(stream),
                        Err(error) => {
                            let _ = init_sender.send(Err(error));
                            return;
                        }
                    },
                    None => None,
                };

                if let Some(master_stream) = master_stream.as_ref() {
                    if let Err(error) = master_stream.play() {
                        let _ = init_sender.send(Err(format!(
                            "failed to start master mirror stream: {error}"
                        )));
                        return;
                    }
                }

                let _ = init_sender.send(Ok(()));
                let _ = shutdown_receiver.recv();
                drop(master_stream);
                drop(stream);
            })
            .map_err(|error| format!("failed to spawn audio thread: {error}"))?;

        init_receiver
            .recv()
            .map_err(|_| "audio thread failed during startup".to_string())??;

        Ok(Self {
            state,
            commands: command_sender,
            shutdown: shutdown_sender,
            sample_rate,
        })
    }

    pub fn load_deck(&self, deck: DeckId, path: impl AsRef<Path>) -> Result<(), String> {
        validate_file(path.as_ref())?;
        self.send(AudioCommand::LoadPath {
            deck,
            path: path.as_ref().to_path_buf(),
            sample_rate: self.sample_rate,
        })
    }

    pub fn load_deck_blocking(&self, deck: DeckId, path: impl AsRef<Path>) -> Result<(), String> {
        let samples = decode_file(path.as_ref(), self.sample_rate)?;
        self.send(AudioCommand::LoadSamples { deck, samples })
    }

    pub fn play_deck(&self, deck: DeckId) -> Result<(), String> {
        self.send(AudioCommand::Play { deck })
    }

    pub fn pause_deck(&self, deck: DeckId) -> Result<(), String> {
        self.send(AudioCommand::Pause { deck })
    }

    pub fn seek_deck(&self, deck: DeckId, position: f32) -> Result<(), String> {
        self.send(AudioCommand::Seek { deck, position })
    }

    pub fn start_deck_scrub(&self, deck: DeckId) -> Result<(), String> {
        self.send(AudioCommand::ScrubStart { deck })
    }

    pub fn scrub_deck_to_position(&self, deck: DeckId, position: f32) -> Result<(), String> {
        self.send(AudioCommand::ScrubTo { deck, position })
    }

    pub fn end_deck_scrub(&self, deck: DeckId) -> Result<(), String> {
        self.send(AudioCommand::ScrubEnd { deck })
    }

    pub fn set_deck_volume(&self, deck: DeckId, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckVolume { deck, volume })
    }

    pub fn set_deck_tempo(&self, deck: DeckId, tempo_percent: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckTempo {
            deck,
            tempo_percent,
        })
    }

    pub fn set_deck_beat_sync(
        &self,
        follower: DeckId,
        master: DeckId,
        enabled: bool,
        follower_bpm: f64,
        master_bpm: f64,
        follower_beat_grid: Vec<AudioBeatGridMarker>,
        master_beat_grid: Vec<AudioBeatGridMarker>,
    ) -> Result<(), String> {
        let (ack_sender, ack_receiver) = mpsc::channel();
        self.send(AudioCommand::DeckBeatSync {
            follower,
            master,
            enabled,
            follower_bpm,
            master_bpm,
            follower_beat_grid,
            master_beat_grid,
            ack: Some(ack_sender),
        })?;
        ack_receiver
            .recv_timeout(Duration::from_millis(250))
            .map_err(|_| "audio engine did not apply beat sync in time".to_string())?
    }

    pub fn set_deck_filter(&self, deck: DeckId, cutoff_hz: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckFilter { deck, cutoff_hz })
    }

    pub fn set_deck_filter_amount(&self, deck: DeckId, amount: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckFilterAmount { deck, amount })
    }

    pub fn set_deck_eq(&self, deck: DeckId, high: f32, mid: f32, low: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckEq {
            deck,
            high,
            mid,
            low,
        })
    }

    pub fn set_deck_cue(&self, deck: DeckId, enabled: bool) -> Result<(), String> {
        self.send(AudioCommand::DeckCue { deck, enabled })
    }

    pub fn set_deck_fx_chain(
        &self,
        deck: DeckId,
        effects: Vec<DeckFxConfig>,
    ) -> Result<(), String> {
        self.send(AudioCommand::DeckFxChain { deck, effects })
    }

    pub fn add_deck_fx(&self, deck: DeckId, effect: DeckFxConfig) -> Result<(), String> {
        self.send(AudioCommand::DeckFxAdd { deck, effect })
    }

    pub fn clear_deck_fx(&self, deck: DeckId) -> Result<(), String> {
        self.send(AudioCommand::DeckFxClear { deck })
    }

    pub fn set_master_volume(&self, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::MasterVolume { volume })
    }

    pub fn set_headphone_volume(&self, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::HeadphoneVolume { volume })
    }

    pub fn set_headphone_mix(&self, mix: f32) -> Result<(), String> {
        self.send(AudioCommand::HeadphoneMix { mix })
    }

    pub fn set_output_routing(
        &self,
        master_start: usize,
        headphone_start: usize,
    ) -> Result<(), String> {
        self.send(AudioCommand::OutputRouting {
            master_start,
            headphone_start,
        })
    }

    pub fn deck_position(&self, deck: DeckId) -> Result<f32, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "audio engine state lock poisoned".to_string())?;
        Ok(state.decks[deck.index()].position_ratio())
    }

    pub fn deck_error(&self, deck: DeckId) -> Result<Option<String>, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "audio engine state lock poisoned".to_string())?;
        Ok(state.decks[deck.index()]
            .decoder_error()
            .map(str::to_string))
    }

    pub fn deck_level_db(&self, deck: DeckId) -> Result<f32, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "audio engine state lock poisoned".to_string())?;
        Ok(state.deck_level_db(deck))
    }

    fn send(&self, command: AudioCommand) -> Result<(), String> {
        self.commands
            .send(command)
            .map_err(|_| "audio engine command thread stopped".to_string())
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
    }
}

pub fn list_output_devices(
    selected_id: Option<&str>,
    master_selected_id: Option<&str>,
) -> Result<Vec<AudioOutputDevice>, String> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    if let Some(default_device) = host.default_output_device() {
        if let Ok(config) = preferred_output_config(&default_device) {
            let name = default_device
                .name()
                .unwrap_or_else(|_| "Default output".to_string());
            devices.push(audio_output_device(
                "default",
                name,
                config,
                selected_id.unwrap_or("default") == "default",
                master_selected_id == Some("default"),
            ));
        }
    }

    let output_devices = host
        .output_devices()
        .map_err(|error| format!("failed to list output devices: {error}"))?;

    for (index, device) in output_devices.enumerate() {
        let id = format!("output:{index}");
        let Ok(config) = preferred_output_config(&device) else {
            continue;
        };
        let name = device.name().unwrap_or_else(|_| format!("Output {index}"));
        devices.push(audio_output_device(
            &id,
            name,
            config,
            selected_id == Some(id.as_str()),
            master_selected_id == Some(id.as_str()),
        ));
    }

    Ok(devices)
}

enum AudioCommand {
    LoadSamples {
        deck: DeckId,
        samples: Vec<[f32; 2]>,
    },
    LoadPath {
        deck: DeckId,
        path: std::path::PathBuf,
        sample_rate: u32,
    },
    Play {
        deck: DeckId,
    },
    Pause {
        deck: DeckId,
    },
    Seek {
        deck: DeckId,
        position: f32,
    },
    ScrubStart {
        deck: DeckId,
    },
    ScrubTo {
        deck: DeckId,
        position: f32,
    },
    ScrubEnd {
        deck: DeckId,
    },
    DeckVolume {
        deck: DeckId,
        volume: f32,
    },
    DeckTempo {
        deck: DeckId,
        tempo_percent: f32,
    },
    DeckBeatSync {
        follower: DeckId,
        master: DeckId,
        enabled: bool,
        follower_bpm: f64,
        master_bpm: f64,
        follower_beat_grid: Vec<AudioBeatGridMarker>,
        master_beat_grid: Vec<AudioBeatGridMarker>,
        ack: Option<Sender<Result<(), String>>>,
    },
    DeckFilter {
        deck: DeckId,
        cutoff_hz: f32,
    },
    DeckFilterAmount {
        deck: DeckId,
        amount: f32,
    },
    DeckEq {
        deck: DeckId,
        high: f32,
        mid: f32,
        low: f32,
    },
    DeckCue {
        deck: DeckId,
        enabled: bool,
    },
    DeckFxChain {
        deck: DeckId,
        effects: Vec<DeckFxConfig>,
    },
    DeckFxAdd {
        deck: DeckId,
        effect: DeckFxConfig,
    },
    DeckFxClear {
        deck: DeckId,
    },
    MasterVolume {
        volume: f32,
    },
    HeadphoneVolume {
        volume: f32,
    },
    HeadphoneMix {
        mix: f32,
    },
    OutputRouting {
        master_start: usize,
        headphone_start: usize,
    },
}

struct MixerState {
    decks: [Deck; 2],
    deck_levels: [LevelMeter; 2],
    master_volume: f32,
    headphone_volume: f32,
    headphone_mix: f32,
    master_output_start: usize,
    headphone_output_start: usize,
    beat_sync: Option<BeatSyncState>,
}

impl MixerState {
    fn new(sample_rate: u32) -> Self {
        let sample_rate_f32 = sample_rate as f32;
        let mut deck_a = Deck::new(sample_rate_f32);
        let mut deck_b = Deck::new(sample_rate_f32);
        deck_a.set_sample_rate(sample_rate_f32);
        deck_b.set_sample_rate(sample_rate_f32);

        Self {
            decks: [deck_a, deck_b],
            deck_levels: [LevelMeter::new(), LevelMeter::new()],
            master_volume: 0.9,
            headphone_volume: 0.9,
            headphone_mix: 0.0,
            master_output_start: 0,
            headphone_output_start: 2,
            beat_sync: None,
        }
    }

    fn next_output_frame(&mut self) -> OutputFrame {
        self.apply_beat_sync_rate();

        let mut master = [0.0, 0.0];
        let mut cue = [0.0, 0.0];

        for (index, deck) in self.decks.iter_mut().enumerate() {
            if let Some(frame) = deck.next_frame() {
                self.deck_levels[index].observe_frame(frame);
                master[0] += frame[0];
                master[1] += frame[1];
                if deck.cue_enabled() {
                    cue[0] += frame[0];
                    cue[1] += frame[1];
                }
            } else {
                self.deck_levels[index].decay_silence();
            }
        }

        let master = [
            soft_clip(master[0] * self.master_volume),
            soft_clip(master[1] * self.master_volume),
        ];
        let cue_mix = 1.0 - self.headphone_mix;
        let master_mix = self.headphone_mix;
        let headphones = [
            soft_clip((cue[0] * cue_mix + master[0] * master_mix) * self.headphone_volume),
            soft_clip((cue[1] * cue_mix + master[1] * master_mix) * self.headphone_volume),
        ];

        OutputFrame { master, headphones }
    }

    fn apply(&mut self, command: AudioCommand) {
        match command {
            AudioCommand::LoadSamples { deck, samples } => self.decks[deck.index()].load(samples),
            AudioCommand::LoadPath {
                deck,
                path,
                sample_rate,
            } => {
                let (sender, receiver) = mpsc::channel::<DecodeMessage>();
                self.decks[deck.index()].load_stream(receiver);
                thread::Builder::new()
                    .name(format!("playcircle-decode-{deck:?}"))
                    .spawn(move || {
                        if let Err(error) =
                            decode_file_to_sender(&path, sample_rate, sender.clone())
                        {
                            let _ = sender.send(DecodeMessage::Error(error));
                        }
                    })
                    .ok();
            }
            AudioCommand::Play { deck } => self.decks[deck.index()].play(),
            AudioCommand::Pause { deck } => self.decks[deck.index()].pause(),
            AudioCommand::Seek { deck, position } => {
                self.decks[deck.index()].set_position_ratio(position)
            }
            AudioCommand::ScrubStart { deck } => self.decks[deck.index()].start_scrub(),
            AudioCommand::ScrubTo { deck, position } => {
                self.decks[deck.index()].scrub_to_position_ratio(position)
            }
            AudioCommand::ScrubEnd { deck } => self.decks[deck.index()].end_scrub(),
            AudioCommand::DeckVolume { deck, volume } => {
                self.decks[deck.index()].set_volume(volume)
            }
            AudioCommand::DeckTempo {
                deck,
                tempo_percent,
            } => {
                if self
                    .beat_sync
                    .as_ref()
                    .map(|sync| sync.follower == deck)
                    .unwrap_or(false)
                {
                    return;
                }
                self.decks[deck.index()].set_tempo_percent(tempo_percent)
            }
            AudioCommand::DeckBeatSync {
                follower,
                master,
                enabled,
                follower_bpm,
                master_bpm,
                follower_beat_grid,
                master_beat_grid,
                ack,
            } => {
                self.set_beat_sync(
                    follower,
                    master,
                    enabled,
                    follower_bpm,
                    master_bpm,
                    follower_beat_grid,
                    master_beat_grid,
                );
                if let Some(ack) = ack {
                    let _ = ack.send(Ok(()));
                }
            }
            AudioCommand::DeckFilter { deck, cutoff_hz } => {
                self.decks[deck.index()].set_filter_cutoff(cutoff_hz)
            }
            AudioCommand::DeckFilterAmount { deck, amount } => {
                self.decks[deck.index()].set_filter_amount(amount)
            }
            AudioCommand::DeckEq {
                deck,
                high,
                mid,
                low,
            } => self.decks[deck.index()].set_eq(high, mid, low),
            AudioCommand::DeckCue { deck, enabled } => {
                self.decks[deck.index()].set_cue_enabled(enabled)
            }
            AudioCommand::DeckFxChain { deck, effects } => {
                self.decks[deck.index()].set_fx_chain(effects)
            }
            AudioCommand::DeckFxAdd { deck, effect } => self.decks[deck.index()].add_fx(effect),
            AudioCommand::DeckFxClear { deck } => self.decks[deck.index()].clear_fx(),
            AudioCommand::MasterVolume { volume } => {
                self.master_volume = volume.clamp(0.0, 1.5);
            }
            AudioCommand::HeadphoneVolume { volume } => {
                self.headphone_volume = volume.clamp(0.0, 1.5);
            }
            AudioCommand::HeadphoneMix { mix } => {
                self.headphone_mix = mix.clamp(0.0, 1.0);
            }
            AudioCommand::OutputRouting {
                master_start,
                headphone_start,
            } => {
                self.master_output_start = master_start;
                self.headphone_output_start = headphone_start;
            }
        }
    }

    fn deck_level_db(&self, deck: DeckId) -> f32 {
        self.deck_levels[deck.index()].db()
    }

    fn set_beat_sync(
        &mut self,
        follower: DeckId,
        master: DeckId,
        enabled: bool,
        follower_bpm: f64,
        master_bpm: f64,
        follower_beat_grid: Vec<AudioBeatGridMarker>,
        master_beat_grid: Vec<AudioBeatGridMarker>,
    ) {
        if !enabled || follower == master || follower_bpm <= 0.0 || master_bpm <= 0.0 {
            self.beat_sync = None;
            return;
        }

        self.beat_sync = Some(BeatSyncState {
            follower,
            master,
            follower_bpm,
            master_bpm,
            follower_beat_grid,
            master_beat_grid,
        });
        self.apply_beat_sync_rate();
        self.lock_follower_to_master_phase();
    }

    fn apply_beat_sync_rate(&mut self) {
        let Some(sync) = self.beat_sync.clone() else {
            return;
        };
        let master_rate = self.decks[sync.master.index()].playback_rate();
        let synced_rate = master_rate * sync.master_bpm / sync.follower_bpm;
        self.decks[sync.follower.index()].set_playback_rate(synced_rate);
    }

    fn lock_follower_to_master_phase(&mut self) {
        let Some(sync) = self.beat_sync.clone() else {
            return;
        };
        let master_position_sec = self.decks[sync.master.index()].position_seconds();
        let follower_position_sec = self.decks[sync.follower.index()].position_seconds();
        let follower_total_sec = self.decks[sync.follower.index()].total_seconds();
        if follower_total_sec <= 0.0 {
            return;
        }

        let master_beat = beat_at(&sync.master_beat_grid, sync.master_bpm, master_position_sec);
        let follower_segment = matching_segment(
            &sync.follower_beat_grid,
            sync.follower_bpm,
            follower_position_sec,
            master_beat,
        );
        let target_sec = follower_segment.start_sec + master_beat.phase * follower_segment.span_sec;
        let follower_sample_rate = self.decks[sync.follower.index()].sample_rate();
        self.decks[sync.follower.index()]
            .set_position_frames(target_sec.clamp(0.0, follower_total_sec) * follower_sample_rate);
    }
}

#[derive(Clone, Copy)]
struct OutputFrame {
    master: [f32; 2],
    headphones: [f32; 2],
}

#[derive(Clone)]
struct BeatSyncState {
    follower: DeckId,
    master: DeckId,
    follower_bpm: f64,
    master_bpm: f64,
    follower_beat_grid: Vec<AudioBeatGridMarker>,
    master_beat_grid: Vec<AudioBeatGridMarker>,
}

#[derive(Clone, Copy)]
struct BeatSegment {
    start_sec: f64,
    span_sec: f64,
    beat_number: i32,
    phase: f64,
}

fn beat_at(grid: &[AudioBeatGridMarker], bpm: f64, position_sec: f64) -> BeatSegment {
    let segment = beat_segment_at(grid, bpm, position_sec);
    BeatSegment {
        phase: ((position_sec - segment.start_sec) / segment.span_sec).clamp(0.0, 1.0),
        ..segment
    }
}

fn beat_segment_at(grid: &[AudioBeatGridMarker], bpm: f64, position_sec: f64) -> BeatSegment {
    if grid.len() >= 2 {
        let next_index = grid
            .iter()
            .position(|beat| beat.time_seconds > position_sec)
            .unwrap_or(grid.len() - 1);
        let current_index = if next_index == 0 {
            0
        } else if next_index >= grid.len() - 1 {
            grid.len() - 2
        } else {
            next_index - 1
        };
        let current = &grid[current_index];
        let next = &grid[current_index + 1];
        return BeatSegment {
            start_sec: current.time_seconds,
            span_sec: (next.time_seconds - current.time_seconds).max(0.001),
            beat_number: current.beat_number,
            phase: 0.0,
        };
    }

    let span_sec = if bpm > 0.0 { 60.0 / bpm } else { 0.5 };
    let beat_index = (position_sec / span_sec).floor() as i32;
    BeatSegment {
        start_sec: (position_sec / span_sec).floor() * span_sec,
        span_sec,
        beat_number: beat_index.rem_euclid(4) + 1,
        phase: 0.0,
    }
}

fn matching_segment(
    grid: &[AudioBeatGridMarker],
    bpm: f64,
    follower_position_sec: f64,
    master_beat: BeatSegment,
) -> BeatSegment {
    if grid.len() < 2 {
        return beat_segment_at(grid, bpm, follower_position_sec);
    }

    let target_beat_number = normalize_beat_number(master_beat.beat_number);
    let mut best_segment = None;
    let mut best_distance = f64::INFINITY;

    for index in 0..grid.len() - 1 {
        let current = &grid[index];
        if normalize_beat_number(current.beat_number) != target_beat_number {
            continue;
        }
        let next = &grid[index + 1];
        let span_sec = (next.time_seconds - current.time_seconds).max(0.001);
        let candidate_sec = current.time_seconds + master_beat.phase * span_sec;
        let distance = (candidate_sec - follower_position_sec).abs();
        if distance < best_distance {
            best_distance = distance;
            best_segment = Some(BeatSegment {
                start_sec: current.time_seconds,
                span_sec,
                beat_number: current.beat_number,
                phase: 0.0,
            });
        }
    }

    best_segment.unwrap_or_else(|| beat_segment_at(grid, bpm, follower_position_sec))
}

fn normalize_beat_number(beat_number: i32) -> i32 {
    (beat_number.max(1) - 1).rem_euclid(4) + 1
}

#[derive(Clone, Copy)]
struct LevelMeter {
    peak: f32,
}

impl LevelMeter {
    fn new() -> Self {
        Self { peak: 0.0 }
    }

    fn observe_frame(&mut self, frame: [f32; 2]) {
        let sample_peak = frame[0].abs().max(frame[1].abs());
        self.peak = self.peak.max(sample_peak).min(2.0);
        self.peak *= 0.9995;
    }

    fn decay_silence(&mut self) {
        self.peak *= 0.995;
        if self.peak < 0.000_001 {
            self.peak = 0.0;
        }
    }

    fn db(&self) -> f32 {
        if self.peak <= 0.000_001 {
            return -60.0;
        }

        (20.0 * self.peak.log10()).clamp(-60.0, 6.0)
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    state: Arc<Mutex<MixerState>>,
    master_tap: Arc<Mutex<MasterTap>>,
    commands: Receiver<AudioCommand>,
) -> Result<Stream, String>
where
    T: Sample + SizedSample + FromSample<f32>,
{
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| {
                write_output(output, channels, &state, &master_tap, &commands)
            },
            move |error| eprintln!("playcircle audio stream error: {error}"),
            None,
        )
        .map_err(|error| format!("failed to build output stream: {error}"))
}

fn write_output<T>(
    output: &mut [T],
    channels: usize,
    state: &Arc<Mutex<MixerState>>,
    master_tap: &Arc<Mutex<MasterTap>>,
    commands: &Receiver<AudioCommand>,
) where
    T: Sample + FromSample<f32>,
{
    let Ok(mut state) = state.try_lock() else {
        for sample in output {
            *sample = T::from_sample(0.0);
        }
        return;
    };

    while let Ok(command) = commands.try_recv() {
        state.apply(command);
    }

    let mut routed_frame = vec![0.0_f32; channels];

    for frame in output.chunks_mut(channels) {
        routed_frame.fill(0.0);
        let mixed = state.next_output_frame();
        if let Ok(mut tap) = master_tap.try_lock() {
            tap.push(mixed.master);
        }
        add_stereo_pair(&mut routed_frame, state.master_output_start, mixed.master);
        add_stereo_pair(
            &mut routed_frame,
            state.headphone_output_start,
            mixed.headphones,
        );

        for (sample, value) in frame.iter_mut().zip(routed_frame.iter()) {
            *sample = T::from_sample(soft_clip(*value));
        }
    }
}

fn add_stereo_pair(frame: &mut [f32], start: usize, sample: [f32; 2]) {
    if start + 1 >= frame.len() {
        return;
    }

    frame[start] += sample[0];
    frame[start + 1] += sample[1];
}

fn build_master_mirror_stream(
    output_device_id: &str,
    master_tap: Arc<Mutex<MasterTap>>,
) -> Result<Stream, String> {
    let host = cpal::default_host();
    let device = output_device(&host, Some(output_device_id))?;
    let supported_config = preferred_output_config(&device)?;
    let channels = supported_config.channels() as usize;
    let config = supported_config.config();

    match supported_config.sample_format() {
        SampleFormat::F32 => build_master_tap_stream::<f32>(&device, &config, channels, master_tap),
        SampleFormat::I16 => build_master_tap_stream::<i16>(&device, &config, channels, master_tap),
        SampleFormat::U16 => build_master_tap_stream::<u16>(&device, &config, channels, master_tap),
        sample_format => Err(format!(
            "unsupported master mirror sample format: {sample_format:?}"
        )),
    }
}

fn build_master_tap_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    master_tap: Arc<Mutex<MasterTap>>,
) -> Result<Stream, String>
where
    T: Sample + SizedSample + FromSample<f32>,
{
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| write_master_tap_output(output, channels, &master_tap),
            move |error| eprintln!("playcircle master mirror stream error: {error}"),
            None,
        )
        .map_err(|error| format!("failed to build master mirror stream: {error}"))
}

fn write_master_tap_output<T>(output: &mut [T], channels: usize, master_tap: &Arc<Mutex<MasterTap>>)
where
    T: Sample + FromSample<f32>,
{
    let Ok(mut tap) = master_tap.try_lock() else {
        for sample in output {
            *sample = T::from_sample(0.0);
        }
        return;
    };

    for frame in output.chunks_mut(channels) {
        let sample = tap.pop().unwrap_or([0.0, 0.0]);
        if let Some(left) = frame.get_mut(0) {
            *left = T::from_sample(sample[0]);
        }
        if let Some(right) = frame.get_mut(1) {
            *right = T::from_sample(sample[1]);
        }
        for sample in frame.iter_mut().skip(2) {
            *sample = T::from_sample(0.0);
        }
    }
}

struct MasterTap {
    frames: VecDeque<[f32; 2]>,
    capacity: usize,
}

impl MasterTap {
    fn new(sample_rate: usize) -> Self {
        Self {
            frames: VecDeque::with_capacity(sample_rate / 2),
            capacity: (sample_rate / 2).max(1024),
        }
    }

    fn push(&mut self, frame: [f32; 2]) {
        while self.frames.len() >= self.capacity {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
    }

    fn pop(&mut self) -> Option<[f32; 2]> {
        self.frames.pop_front()
    }
}

fn preferred_output_config(device: &cpal::Device) -> Result<SupportedStreamConfig, String> {
    let default_config = device
        .default_output_config()
        .map_err(|error| format!("failed to get default output config: {error}"))?;

    let preferred_rate = default_config.sample_rate();
    let default_format = default_config.sample_format();
    let mut best = default_config;

    let supported_configs = match device.supported_output_configs() {
        Ok(configs) => configs,
        Err(_) => return Ok(best),
    };

    for range in supported_configs {
        if range.sample_format() != default_format || range.channels() < best.channels() {
            continue;
        }

        let rate = preferred_rate.clamp(range.min_sample_rate(), range.max_sample_rate());
        best = range.with_sample_rate(rate);
    }

    Ok(best)
}

fn audio_output_device(
    id: &str,
    name: String,
    config: SupportedStreamConfig,
    selected: bool,
    master_selected: bool,
) -> AudioOutputDevice {
    AudioOutputDevice {
        id: id.to_string(),
        name,
        channels: config.channels(),
        sample_rate: config.sample_rate().0,
        cue_supported: config.channels() >= 4,
        selected,
        master_selected,
    }
}

fn output_device(
    host: &cpal::Host,
    output_device_id: Option<&str>,
) -> Result<cpal::Device, String> {
    let Some(output_device_id) = output_device_id else {
        return host
            .default_output_device()
            .ok_or_else(|| "no default output audio device available".to_string());
    };

    if output_device_id == "default" {
        return host
            .default_output_device()
            .ok_or_else(|| "no default output audio device available".to_string());
    }

    let index = output_device_id
        .strip_prefix("output:")
        .ok_or_else(|| format!("invalid output device id {output_device_id}"))?
        .parse::<usize>()
        .map_err(|_| format!("invalid output device id {output_device_id}"))?;

    host.output_devices()
        .map_err(|error| format!("failed to list output devices: {error}"))?
        .nth(index)
        .ok_or_else(|| format!("output device {output_device_id} is no longer available"))
}

fn soft_clip(value: f32) -> f32 {
    let value = value.clamp(-2.0, 2.0);
    value / (1.0 + value.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silent_frames(count: usize) -> Vec<[f32; 2]> {
        vec![[0.0, 0.0]; count]
    }

    fn beat_grid(bpm: f64, beats: usize) -> Vec<AudioBeatGridMarker> {
        let span = 60.0 / bpm;
        (0..beats)
            .map(|index| AudioBeatGridMarker {
                time_seconds: index as f64 * span,
                beat_number: (index as i32 % 4) + 1,
            })
            .collect()
    }

    #[test]
    fn beat_sync_sets_follower_rate_from_master_audio_rate() {
        let mut mixer = MixerState::new(1_000);
        mixer.decks[DeckId::A.index()].load(silent_frames(10_000));
        mixer.decks[DeckId::B.index()].load(silent_frames(10_000));
        mixer.decks[DeckId::A.index()].set_tempo_percent(10.0);

        mixer.set_beat_sync(
            DeckId::B,
            DeckId::A,
            true,
            110.0,
            120.0,
            beat_grid(110.0, 16),
            beat_grid(120.0, 16),
        );

        let expected_rate = 1.1 * 120.0 / 110.0;
        let actual_rate = mixer.decks[DeckId::B.index()].playback_rate();
        assert!((actual_rate - expected_rate).abs() < 0.000_001);
    }

    #[test]
    fn beat_sync_locks_follower_to_nearest_matching_beat_phase_once() {
        let mut mixer = MixerState::new(1_000);
        mixer.decks[DeckId::A.index()].load(silent_frames(10_000));
        mixer.decks[DeckId::B.index()].load(silent_frames(10_000));
        mixer.decks[DeckId::A.index()].set_position_frames(750.0);
        mixer.decks[DeckId::B.index()].set_position_frames(4_000.0);

        mixer.set_beat_sync(
            DeckId::B,
            DeckId::A,
            true,
            90.0,
            120.0,
            beat_grid(90.0, 16),
            beat_grid(120.0, 16),
        );

        let expected_position_sec = (5.0 * (60.0 / 90.0)) + (0.5 * (60.0 / 90.0));
        let actual_position_sec = mixer.decks[DeckId::B.index()].position_seconds();
        assert!((actual_position_sec - expected_position_sec).abs() < 0.001);
    }
}
