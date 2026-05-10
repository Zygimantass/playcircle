use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};

use crate::deck::Deck;
use crate::decoder::{decode_file, decode_file_to_sender, DecodeMessage};

#[derive(Debug, Clone, Copy)]
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
    sample_rate: u32,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no default output audio device available".to_string())?;
        let supported_config = device
            .default_output_config()
            .map_err(|error| format!("failed to get default output config: {error}"))?;
        let sample_rate = supported_config.sample_rate().0;
        let channels = supported_config.channels() as usize;
        let state = Arc::new(Mutex::new(MixerState::new(sample_rate)));
        let config = supported_config.config();
        let sample_format = supported_config.sample_format();
        let (command_sender, command_receiver) = mpsc::channel::<AudioCommand>();
        let (init_sender, init_receiver) = mpsc::channel::<Result<(), String>>();
        let thread_state = state.clone();

        thread::Builder::new()
            .name("playcircle-audio".to_string())
            .spawn(move || {
                let stream = match sample_format {
                    SampleFormat::F32 => {
                        build_stream::<f32>(&device, &config, channels, thread_state.clone())
                    }
                    SampleFormat::I16 => {
                        build_stream::<i16>(&device, &config, channels, thread_state.clone())
                    }
                    SampleFormat::U16 => {
                        build_stream::<u16>(&device, &config, channels, thread_state.clone())
                    }
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

                let _ = init_sender.send(Ok(()));
                while let Ok(command) = command_receiver.recv() {
                    let Ok(mut state) = thread_state.lock() else {
                        continue;
                    };
                    state.apply(command);
                }

                drop(stream);
            })
            .map_err(|error| format!("failed to spawn audio thread: {error}"))?;

        init_receiver
            .recv()
            .map_err(|_| "audio thread failed during startup".to_string())??;

        Ok(Self {
            state,
            commands: command_sender,
            sample_rate,
        })
    }

    pub fn load_deck(&self, deck: DeckId, path: impl AsRef<Path>) -> Result<(), String> {
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

    pub fn set_deck_volume(&self, deck: DeckId, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckVolume { deck, volume })
    }

    pub fn set_deck_filter(&self, deck: DeckId, cutoff_hz: f32) -> Result<(), String> {
        self.send(AudioCommand::DeckFilter { deck, cutoff_hz })
    }

    pub fn set_deck_cue(&self, deck: DeckId, enabled: bool) -> Result<(), String> {
        self.send(AudioCommand::DeckCue { deck, enabled })
    }

    pub fn set_master_volume(&self, volume: f32) -> Result<(), String> {
        self.send(AudioCommand::MasterVolume { volume })
    }

    pub fn deck_position(&self, deck: DeckId) -> Result<f32, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "audio engine state lock poisoned".to_string())?;
        Ok(state.decks[deck.index()].position_ratio())
    }

    fn send(&self, command: AudioCommand) -> Result<(), String> {
        self.commands
            .send(command)
            .map_err(|_| "audio engine command thread stopped".to_string())
    }
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
    DeckVolume {
        deck: DeckId,
        volume: f32,
    },
    DeckFilter {
        deck: DeckId,
        cutoff_hz: f32,
    },
    DeckCue {
        deck: DeckId,
        enabled: bool,
    },
    MasterVolume {
        volume: f32,
    },
}

struct MixerState {
    decks: [Deck; 2],
    master_volume: f32,
    cue_volume: f32,
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
            master_volume: 0.9,
            cue_volume: 0.9,
        }
    }

    fn next_master_frame(&mut self) -> [f32; 2] {
        let mut master = [0.0, 0.0];
        let mut cue = [0.0, 0.0];

        for deck in &mut self.decks {
            if let Some(frame) = deck.next_frame() {
                master[0] += frame[0];
                master[1] += frame[1];
                if deck.cue_enabled() {
                    cue[0] += frame[0];
                    cue[1] += frame[1];
                }
            }
        }

        // The cue branch is mixed separately now so the engine has the correct
        // graph shape; routing it to a distinct device comes next.
        let _headphones = [cue[0] * self.cue_volume, cue[1] * self.cue_volume];

        [
            soft_clip(master[0] * self.master_volume),
            soft_clip(master[1] * self.master_volume),
        ]
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
            AudioCommand::DeckVolume { deck, volume } => {
                self.decks[deck.index()].set_volume(volume)
            }
            AudioCommand::DeckFilter { deck, cutoff_hz } => {
                self.decks[deck.index()].set_filter_cutoff(cutoff_hz)
            }
            AudioCommand::DeckCue { deck, enabled } => {
                self.decks[deck.index()].set_cue_enabled(enabled)
            }
            AudioCommand::MasterVolume { volume } => {
                self.master_volume = volume.clamp(0.0, 1.5);
            }
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    state: Arc<Mutex<MixerState>>,
) -> Result<Stream, String>
where
    T: Sample + SizedSample + FromSample<f32>,
{
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| write_output(output, channels, &state),
            move |error| eprintln!("playcircle audio stream error: {error}"),
            None,
        )
        .map_err(|error| format!("failed to build output stream: {error}"))
}

fn write_output<T>(output: &mut [T], channels: usize, state: &Arc<Mutex<MixerState>>)
where
    T: Sample + FromSample<f32>,
{
    let Ok(mut state) = state.try_lock() else {
        for sample in output {
            *sample = T::from_sample(0.0);
        }
        return;
    };

    for frame in output.chunks_mut(channels) {
        let mixed = state.next_master_frame();
        if let Some(left) = frame.get_mut(0) {
            *left = T::from_sample(mixed[0]);
        }
        if let Some(right) = frame.get_mut(1) {
            *right = T::from_sample(mixed[1]);
        }
        for sample in frame.iter_mut().skip(2) {
            *sample = T::from_sample((mixed[0] + mixed[1]) * 0.5);
        }
    }
}

fn soft_clip(value: f32) -> f32 {
    let value = value.clamp(-2.0, 2.0);
    value / (1.0 + value.abs())
}
