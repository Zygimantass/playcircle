use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver};

use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ControllerDevice {
    pub id: String,
    pub name: String,
    pub kind: ControllerKind,
    pub connected: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ControllerKind {
    PioneerDdjFlx4,
    GenericMidi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ControllerEvent {
    pub device_id: String,
    pub device_name: String,
    pub action: ControllerAction,
    pub raw: MidiMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MidiMessage {
    pub timestamp_us: u64,
    pub status: u8,
    pub data1: u8,
    pub data2: u8,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControllerAction {
    Raw,
    PlayPause {
        deck: ControllerDeck,
        pressed: bool,
    },
    Cue {
        deck: ControllerDeck,
        pressed: bool,
    },
    LoadSelected {
        deck: ControllerDeck,
    },
    Browse {
        ticks: i8,
        shifted: bool,
    },
    BrowsePress {
        shifted: bool,
        pressed: bool,
    },
    Tempo {
        deck: ControllerDeck,
        value: f32,
    },
    Volume {
        deck: ControllerDeck,
        value: f32,
    },
    Crossfader {
        value: f32,
    },
    Eq {
        deck: ControllerDeck,
        band: EqBand,
        value: f32,
    },
    Filter {
        deck: ControllerDeck,
        value: f32,
    },
    HotCue {
        deck: ControllerDeck,
        index: u8,
        pressed: bool,
    },
    FxSelect {
        direction: i8,
        pressed: bool,
    },
    FxFocus {
        direction: i8,
        pressed: bool,
    },
    FxTarget {
        target: FxTarget,
    },
    FxDepth {
        value: f32,
    },
    FxToggle {
        pressed: bool,
    },
    FxClear {
        pressed: bool,
    },
    JogTouch {
        deck: ControllerDeck,
        pressed: bool,
    },
    Jog {
        deck: ControllerDeck,
        ticks: i8,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ControllerDeck {
    A,
    B,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EqBand {
    High,
    Mid,
    Low,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FxTarget {
    DeckA,
    DeckB,
    Both,
}

pub trait ControllerMapper: Send {
    fn map(&mut self, message: &MidiMessage) -> ControllerAction;
}

pub struct ControllerManager {
    input_connection: Option<MidiInputConnection<()>>,
    output_connection: Option<MidiOutputConnection>,
    receiver: Option<Receiver<ControllerEvent>>,
    connected_device: Option<ControllerDevice>,
}

impl ControllerManager {
    pub fn new() -> Self {
        Self {
            input_connection: None,
            output_connection: None,
            receiver: None,
            connected_device: None,
        }
    }

    pub fn list_devices(&self) -> Result<Vec<ControllerDevice>, String> {
        let midi_in = midi_input()?;
        let ports = midi_in.ports();
        ports
            .iter()
            .enumerate()
            .map(|(index, port)| {
                let name = midi_in
                    .port_name(port)
                    .map_err(|error| format!("failed to read MIDI input {index} name: {error}"))?;
                let id = device_id(index);
                Ok(ControllerDevice {
                    id: id.clone(),
                    name: name.clone(),
                    kind: device_kind_from_name(&name),
                    connected: self
                        .connected_device
                        .as_ref()
                        .map(|device| device.id == id)
                        .unwrap_or(false),
                })
            })
            .collect()
    }

    pub fn connect(&mut self, id: &str) -> Result<ControllerDevice, String> {
        let requested_index = parse_device_id(id)?;
        let mut midi_in = midi_input()?;
        midi_in.ignore(Ignore::None);
        let ports = midi_in.ports();
        let port = ports
            .get(requested_index)
            .ok_or_else(|| format!("MIDI input {id} is no longer available"))?;
        let name = midi_in
            .port_name(port)
            .map_err(|error| format!("failed to read MIDI input {id} name: {error}"))?;
        let device = ControllerDevice {
            id: device_id(requested_index),
            name,
            kind: ControllerKind::GenericMidi,
            connected: true,
        };
        let device = ControllerDevice {
            kind: device_kind_from_name(&device.name),
            ..device
        };
        let device_id = device.id.clone();
        let device_name = device.name.clone();
        let mut mapper = mapper_for_kind(device.kind);
        let (sender, receiver) = mpsc::channel();

        let input_connection = midi_in
            .connect(
                port,
                "playcircle-controller-input",
                move |timestamp_us, bytes, _| {
                    if let Some(raw) = MidiMessage::from_bytes(timestamp_us, bytes) {
                        let action = mapper.map(&raw);
                        let _ = sender.send(ControllerEvent {
                            device_id: device_id.clone(),
                            device_name: device_name.clone(),
                            action,
                            raw,
                        });
                    }
                },
                (),
            )
            .map_err(|error| format!("failed to connect to MIDI input {id}: {error}"))?;
        let output_connection = connect_output_for_device(&device.name).ok();

        self.input_connection = Some(input_connection);
        self.output_connection = output_connection;
        self.receiver = Some(receiver);
        self.connected_device = Some(device.clone());
        Ok(device)
    }

    pub fn disconnect(&mut self) {
        self.input_connection = None;
        self.output_connection = None;
        self.receiver = None;
        self.connected_device = None;
    }

    pub fn poll_events(&mut self) -> Vec<ControllerEvent> {
        self.receiver
            .as_ref()
            .map(|receiver| receiver.try_iter().collect())
            .unwrap_or_default()
    }

    pub fn send_midi(&mut self, bytes: &[u8]) -> Result<(), String> {
        let connection = self
            .output_connection
            .as_mut()
            .ok_or_else(|| "controller MIDI output is not connected".to_string())?;
        connection
            .send(bytes)
            .map_err(|error| format!("failed to send MIDI output: {error}"))
    }
}

impl Default for ControllerManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MidiMessage {
    pub fn from_bytes(timestamp_us: u64, bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return None;
        }

        Some(Self {
            timestamp_us,
            status: bytes[0],
            data1: bytes.get(1).copied().unwrap_or(0),
            data2: bytes.get(2).copied().unwrap_or(0),
            bytes: bytes.to_vec(),
        })
    }
}

pub fn device_kind_from_name(name: &str) -> ControllerKind {
    if name.to_ascii_lowercase().contains("ddj-flx4") {
        ControllerKind::PioneerDdjFlx4
    } else {
        ControllerKind::GenericMidi
    }
}

fn midi_input() -> Result<MidiInput, String> {
    MidiInput::new("playcircle-controller")
        .map_err(|error| format!("failed to initialize MIDI input: {error}"))
}

fn midi_output() -> Result<MidiOutput, String> {
    MidiOutput::new("playcircle-controller-output")
        .map_err(|error| format!("failed to initialize MIDI output: {error}"))
}

fn connect_output_for_device(input_name: &str) -> Result<MidiOutputConnection, String> {
    let midi_out = midi_output()?;
    let ports = midi_out.ports();
    let input_name_lower = input_name.to_ascii_lowercase();
    let requested_kind = device_kind_from_name(input_name);
    let fallback_index = ports.iter().position(|port| {
        midi_out
            .port_name(port)
            .ok()
            .map(|name| device_kind_from_name(&name) == requested_kind)
            .unwrap_or(false)
    });
    let matching_index = ports.iter().position(|port| {
        midi_out
            .port_name(port)
            .ok()
            .map(|name| {
                let name = name.to_ascii_lowercase();
                name == input_name_lower
                    || name.contains(&input_name_lower)
                    || input_name_lower.contains(&name)
            })
            .unwrap_or(false)
    });
    let index = matching_index
        .or(fallback_index)
        .ok_or_else(|| format!("no MIDI output found for {input_name}"))?;
    let port = &ports[index];
    let name = midi_out
        .port_name(port)
        .unwrap_or_else(|_| format!("MIDI output {index}"));
    midi_out
        .connect(port, "playcircle-controller-output")
        .map_err(|error| format!("failed to connect to MIDI output {name}: {error}"))
}

fn device_id(index: usize) -> String {
    format!("midi-in:{index}")
}

fn parse_device_id(id: &str) -> Result<usize, String> {
    id.strip_prefix("midi-in:")
        .ok_or_else(|| format!("invalid MIDI input id {id}"))?
        .parse()
        .map_err(|_| format!("invalid MIDI input id {id}"))
}

fn mapper_for_kind(kind: ControllerKind) -> Box<dyn ControllerMapper> {
    match kind {
        ControllerKind::PioneerDdjFlx4 => Box::new(Flx4Mapper::new()),
        ControllerKind::GenericMidi => Box::new(RawMapper),
    }
}

struct RawMapper;

impl ControllerMapper for RawMapper {
    fn map(&mut self, _message: &MidiMessage) -> ControllerAction {
        ControllerAction::Raw
    }
}

pub struct Flx4Mapper {
    lsb_by_channel_and_cc: HashMap<(u8, u8), u8>,
    beat_fx_deck_a: bool,
    beat_fx_deck_b: bool,
}

impl Flx4Mapper {
    pub fn new() -> Self {
        Self {
            lsb_by_channel_and_cc: HashMap::new(),
            beat_fx_deck_a: false,
            beat_fx_deck_b: false,
        }
    }

    fn map_note(&mut self, channel: u8, note: u8, velocity: u8) -> ControllerAction {
        if let Some(action) = self.map_beat_fx_note(channel, note, velocity) {
            return action;
        }

        if channel == 6 {
            if velocity == 0 {
                return match note {
                    0x41 => ControllerAction::BrowsePress {
                        shifted: false,
                        pressed: false,
                    },
                    0x42 => ControllerAction::BrowsePress {
                        shifted: true,
                        pressed: false,
                    },
                    _ => ControllerAction::Raw,
                };
            }
            return match note {
                0x41 => ControllerAction::BrowsePress {
                    shifted: false,
                    pressed: true,
                },
                0x42 => ControllerAction::BrowsePress {
                    shifted: true,
                    pressed: true,
                },
                0x46 => ControllerAction::LoadSelected {
                    deck: ControllerDeck::A,
                },
                0x47 => ControllerAction::LoadSelected {
                    deck: ControllerDeck::B,
                },
                _ => ControllerAction::Raw,
            };
        }

        if let Some(deck) = hot_cue_deck_from_channel(channel) {
            return match note {
                0x00..=0x07 => ControllerAction::HotCue {
                    deck,
                    index: note + 1,
                    pressed: velocity > 0,
                },
                _ => ControllerAction::Raw,
            };
        }

        let Some(deck) = deck_from_channel(channel) else {
            return ControllerAction::Raw;
        };

        match note {
            0x36 => ControllerAction::JogTouch {
                deck,
                pressed: velocity > 0,
            },
            0x0b => ControllerAction::PlayPause {
                deck,
                pressed: velocity > 0,
            },
            0x0c => ControllerAction::Cue {
                deck,
                pressed: velocity > 0,
            },
            _ => ControllerAction::Raw,
        }
    }

    fn map_beat_fx_note(
        &mut self,
        channel: u8,
        note: u8,
        velocity: u8,
    ) -> Option<ControllerAction> {
        let pressed = velocity > 0;
        match (channel, note) {
            (4, 0x63) => Some(ControllerAction::FxSelect {
                direction: 1,
                pressed,
            }),
            (4, 0x64) => Some(ControllerAction::FxSelect {
                direction: -1,
                pressed,
            }),
            (4, 0x4a) => Some(ControllerAction::FxFocus {
                direction: -1,
                pressed,
            }),
            (4, 0x4b) => Some(ControllerAction::FxFocus {
                direction: 1,
                pressed,
            }),
            (4, 0x10) => {
                self.beat_fx_deck_a = pressed;
                self.beat_fx_target_action()
            }
            (5, 0x11) => {
                self.beat_fx_deck_b = pressed;
                self.beat_fx_target_action()
            }
            (4 | 5, 0x47) => Some(ControllerAction::FxToggle { pressed }),
            (4 | 5, 0x43) => Some(ControllerAction::FxClear { pressed }),
            _ => None,
        }
    }

    fn beat_fx_target_action(&self) -> Option<ControllerAction> {
        let target = match (self.beat_fx_deck_a, self.beat_fx_deck_b) {
            (true, true) => FxTarget::Both,
            (true, false) => FxTarget::DeckA,
            (false, true) => FxTarget::DeckB,
            (false, false) => return None,
        };
        Some(ControllerAction::FxTarget { target })
    }

    fn map_control_change(&mut self, channel: u8, control: u8, value: u8) -> ControllerAction {
        if matches!(control, 0x21 | 0x22 | 0x23 | 0x29) {
            let Some(deck) = deck_from_channel(channel) else {
                return ControllerAction::Raw;
            };
            return ControllerAction::Jog {
                deck,
                ticks: relative_jog_ticks(value),
            };
        }

        if (0x20..=0x3f).contains(&control) {
            self.lsb_by_channel_and_cc
                .insert((channel, control - 0x20), value);
            return ControllerAction::Raw;
        }

        let fine = self
            .lsb_by_channel_and_cc
            .get(&(channel, control))
            .copied()
            .unwrap_or(0);
        let normalized = normalize_14_bit(value, fine);
        let centered = centered_14_bit(value, fine);

        if channel == 4 && control == 0x02 {
            return ControllerAction::FxDepth { value: normalized };
        }

        if channel == 6 {
            return match control {
                0x40 => ControllerAction::Browse {
                    ticks: relative_browse_ticks(value),
                    shifted: false,
                },
                0x64 => ControllerAction::Browse {
                    ticks: relative_browse_ticks(value),
                    shifted: true,
                },
                0x17 => ControllerAction::Filter {
                    deck: ControllerDeck::A,
                    value: centered,
                },
                0x18 => ControllerAction::Filter {
                    deck: ControllerDeck::B,
                    value: centered,
                },
                0x1f => ControllerAction::Crossfader { value: normalized },
                _ => ControllerAction::Raw,
            };
        }

        let Some(deck) = deck_from_channel(channel) else {
            return ControllerAction::Raw;
        };

        match control {
            0x00 => ControllerAction::Tempo {
                deck,
                value: centered,
            },
            0x07 => ControllerAction::Eq {
                deck,
                band: EqBand::High,
                value: centered,
            },
            0x0b => ControllerAction::Eq {
                deck,
                band: EqBand::Mid,
                value: centered,
            },
            0x0f => ControllerAction::Eq {
                deck,
                band: EqBand::Low,
                value: centered,
            },
            0x13 => ControllerAction::Volume {
                deck,
                value: normalized,
            },
            _ => ControllerAction::Raw,
        }
    }
}

impl Default for Flx4Mapper {
    fn default() -> Self {
        Self::new()
    }
}

impl ControllerMapper for Flx4Mapper {
    fn map(&mut self, message: &MidiMessage) -> ControllerAction {
        let command = message.status & 0xf0;
        let channel = message.status & 0x0f;

        match command {
            0x80 => self.map_note(channel, message.data1, 0),
            0x90 => self.map_note(channel, message.data1, message.data2),
            0xb0 => self.map_control_change(channel, message.data1, message.data2),
            _ => ControllerAction::Raw,
        }
    }
}

fn deck_from_channel(channel: u8) -> Option<ControllerDeck> {
    match channel {
        0 => Some(ControllerDeck::A),
        1 => Some(ControllerDeck::B),
        _ => None,
    }
}

fn hot_cue_deck_from_channel(channel: u8) -> Option<ControllerDeck> {
    match channel {
        7 => Some(ControllerDeck::A),
        9 => Some(ControllerDeck::B),
        _ => None,
    }
}

fn normalize_14_bit(msb: u8, lsb: u8) -> f32 {
    let value = ((msb as u16) << 7) | lsb as u16;
    value as f32 / 16_383.0
}

fn centered_14_bit(msb: u8, lsb: u8) -> f32 {
    (normalize_14_bit(msb, lsb) * 2.0 - 1.0).clamp(-1.0, 1.0)
}

fn relative_jog_ticks(value: u8) -> i8 {
    value.wrapping_sub(64) as i8
}

fn relative_browse_ticks(value: u8) -> i8 {
    if value <= 0x3f {
        value as i8
    } else {
        (value as i16 - 0x80) as i8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn midi(status: u8, data1: u8, data2: u8) -> MidiMessage {
        MidiMessage {
            timestamp_us: 0,
            status,
            data1,
            data2,
            bytes: vec![status, data1, data2],
        }
    }

    #[test]
    fn detects_ddj_flx4_by_name() {
        assert_eq!(
            device_kind_from_name("Pioneer DDJ-FLX4 MIDI"),
            ControllerKind::PioneerDdjFlx4
        );
        assert_eq!(
            device_kind_from_name("Some USB MIDI"),
            ControllerKind::GenericMidi
        );
    }

    #[test]
    fn generic_mapper_returns_raw() {
        let mut mapper = RawMapper;
        assert_eq!(mapper.map(&midi(0x90, 0x0b, 0x7f)), ControllerAction::Raw);
    }

    #[test]
    fn flx4_maps_play_and_cue_buttons_per_deck() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0x90, 0x0b, 0x7f)),
            ControllerAction::PlayPause {
                deck: ControllerDeck::A,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x91, 0x0c, 0x00)),
            ControllerAction::Cue {
                deck: ControllerDeck::B,
                pressed: false
            }
        );
    }

    #[test]
    fn flx4_maps_load_buttons_and_hot_cues() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0x96, 0x46, 0x7f)),
            ControllerAction::LoadSelected {
                deck: ControllerDeck::A
            }
        );
        assert_eq!(
            mapper.map(&midi(0x96, 0x47, 0x7f)),
            ControllerAction::LoadSelected {
                deck: ControllerDeck::B
            }
        );
        assert_eq!(
            mapper.map(&midi(0x97, 0x02, 0x7f)),
            ControllerAction::HotCue {
                deck: ControllerDeck::A,
                index: 3,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x99, 0x00, 0x00)),
            ControllerAction::HotCue {
                deck: ControllerDeck::B,
                index: 1,
                pressed: false
            }
        );
    }

    #[test]
    fn flx4_maps_browse_encoder_and_press() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0xb6, 0x40, 0x01)),
            ControllerAction::Browse {
                ticks: 1,
                shifted: false
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb6, 0x64, 0x7f)),
            ControllerAction::Browse {
                ticks: -1,
                shifted: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x96, 0x41, 0x7f)),
            ControllerAction::BrowsePress {
                shifted: false,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x96, 0x42, 0x00)),
            ControllerAction::BrowsePress {
                shifted: true,
                pressed: false
            }
        );
    }

    #[test]
    fn flx4_maps_jog_touch_and_rotation() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0x90, 0x36, 0x7f)),
            ControllerAction::JogTouch {
                deck: ControllerDeck::A,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x91, 0x36, 0x00)),
            ControllerAction::JogTouch {
                deck: ControllerDeck::B,
                pressed: false
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb0, 0x22, 0x41)),
            ControllerAction::Jog {
                deck: ControllerDeck::A,
                ticks: 1
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb1, 0x22, 0x3f)),
            ControllerAction::Jog {
                deck: ControllerDeck::B,
                ticks: -1
            }
        );
    }

    #[test]
    fn flx4_maps_eq_and_volume_controls() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0xb0, 0x07, 0x40)),
            ControllerAction::Eq {
                deck: ControllerDeck::A,
                band: EqBand::High,
                value: centered_14_bit(0x40, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb1, 0x0b, 0x20)),
            ControllerAction::Eq {
                deck: ControllerDeck::B,
                band: EqBand::Mid,
                value: centered_14_bit(0x20, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb1, 0x0f, 0x60)),
            ControllerAction::Eq {
                deck: ControllerDeck::B,
                band: EqBand::Low,
                value: centered_14_bit(0x60, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb0, 0x13, 0x7f)),
            ControllerAction::Volume {
                deck: ControllerDeck::A,
                value: normalize_14_bit(0x7f, 0)
            }
        );
    }

    #[test]
    fn flx4_maps_master_channel_filter_and_crossfader() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0xb6, 0x17, 0x40)),
            ControllerAction::Filter {
                deck: ControllerDeck::A,
                value: centered_14_bit(0x40, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb6, 0x18, 0x20)),
            ControllerAction::Filter {
                deck: ControllerDeck::B,
                value: centered_14_bit(0x20, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb6, 0x1f, 0x7f)),
            ControllerAction::Crossfader {
                value: normalize_14_bit(0x7f, 0)
            }
        );
    }

    #[test]
    fn flx4_maps_beat_fx_controls() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0x94, 0x63, 0x7f)),
            ControllerAction::FxSelect {
                direction: 1,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x94, 0x64, 0x7f)),
            ControllerAction::FxSelect {
                direction: -1,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x94, 0x4a, 0x7f)),
            ControllerAction::FxFocus {
                direction: -1,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0x94, 0x4b, 0x7f)),
            ControllerAction::FxFocus {
                direction: 1,
                pressed: true
            }
        );
        assert_eq!(
            mapper.map(&midi(0xb4, 0x02, 0x40)),
            ControllerAction::FxDepth {
                value: normalize_14_bit(0x40, 0)
            }
        );
        assert_eq!(
            mapper.map(&midi(0x94, 0x47, 0x7f)),
            ControllerAction::FxToggle { pressed: true }
        );
        assert_eq!(
            mapper.map(&midi(0x95, 0x43, 0x7f)),
            ControllerAction::FxClear { pressed: true }
        );
    }

    #[test]
    fn flx4_maps_beat_fx_channel_target() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(
            mapper.map(&midi(0x94, 0x10, 0x7f)),
            ControllerAction::FxTarget {
                target: FxTarget::DeckA
            }
        );
        assert_eq!(
            mapper.map(&midi(0x95, 0x11, 0x7f)),
            ControllerAction::FxTarget {
                target: FxTarget::Both
            }
        );
        assert_eq!(
            mapper.map(&midi(0x94, 0x10, 0x00)),
            ControllerAction::FxTarget {
                target: FxTarget::DeckB
            }
        );
    }

    #[test]
    fn flx4_uses_lsb_for_14_bit_controls() {
        let mut mapper = Flx4Mapper::new();
        assert_eq!(mapper.map(&midi(0xb0, 0x33, 0x7f)), ControllerAction::Raw);
        assert_eq!(
            mapper.map(&midi(0xb0, 0x13, 0x7f)),
            ControllerAction::Volume {
                deck: ControllerDeck::A,
                value: normalize_14_bit(0x7f, 0x7f)
            }
        );
    }
}
