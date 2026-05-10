#[derive(Debug, Clone, Copy)]
pub struct OnePoleLowPass {
    current_cutoff_hz: f32,
    target_cutoff_hz: f32,
    sample_rate: f32,
    left: f32,
    right: f32,
}

impl OnePoleLowPass {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            current_cutoff_hz: 20_000.0,
            target_cutoff_hz: 20_000.0,
            sample_rate,
            left: 0.0,
            right: 0.0,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
    }

    pub fn set_cutoff(&mut self, cutoff_hz: f32) {
        self.target_cutoff_hz = cutoff_hz.clamp(60.0, 20_000.0);
    }

    pub fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        self.current_cutoff_hz += (self.target_cutoff_hz - self.current_cutoff_hz) * 0.001;
        let rc = 1.0 / (std::f32::consts::TAU * self.current_cutoff_hz);
        let dt = 1.0 / self.sample_rate;
        let alpha = dt / (rc + dt);

        self.left += alpha * (sample[0] - self.left);
        self.right += alpha * (sample[1] - self.right);
        [self.left, self.right]
    }
}

#[derive(Debug)]
pub struct Deck {
    buffer: Vec<[f32; 2]>,
    decoded_frames: u64,
    total_frames: Option<u64>,
    played_frames: u64,
    playing: bool,
    volume: f32,
    cue_enabled: bool,
    filter: OnePoleLowPass,
    decoder: Option<Receiver<DecodeMessage>>,
    decoder_finished: bool,
    decoder_error: Option<String>,
}

impl Deck {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            buffer: Vec::new(),
            decoded_frames: 0,
            total_frames: None,
            played_frames: 0,
            playing: false,
            volume: 0.85,
            cue_enabled: false,
            filter: OnePoleLowPass::new(sample_rate),
            decoder: None,
            decoder_finished: true,
            decoder_error: None,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.filter.set_sample_rate(sample_rate);
    }

    pub fn load(&mut self, samples: Vec<[f32; 2]>) {
        self.buffer = samples;
        self.decoded_frames = self.buffer.len() as u64;
        self.total_frames = Some(self.decoded_frames);
        self.played_frames = 0;
        self.playing = false;
        self.filter = OnePoleLowPass::new(self.filter_sample_rate());
        self.decoder = None;
        self.decoder_finished = true;
        self.decoder_error = None;
    }

    pub fn load_stream(&mut self, decoder: Receiver<DecodeMessage>) {
        self.buffer.clear();
        self.decoded_frames = 0;
        self.total_frames = None;
        self.played_frames = 0;
        self.playing = false;
        self.filter = OnePoleLowPass::new(self.filter_sample_rate());
        self.decoder = Some(decoder);
        self.decoder_finished = false;
        self.decoder_error = None;
    }

    pub fn play(&mut self) {
        self.playing = true;
    }

    pub fn pause(&mut self) {
        self.playing = false;
    }

    pub fn set_position_ratio(&mut self, ratio: f32) {
        self.drain_decoder_messages();
        let ratio = ratio.clamp(0.0, 1.0);
        let seekable_frames = self.seekable_frames();
        let max_playable_frame = seekable_frames.saturating_sub(1);
        let target_frame = (max_playable_frame as f32 * ratio).round() as u64;
        self.played_frames = target_frame.min(max_playable_frame);
        self.filter = OnePoleLowPass::new(self.filter_sample_rate());
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.5);
    }

    pub fn set_filter_cutoff(&mut self, cutoff_hz: f32) {
        self.filter.set_cutoff(cutoff_hz);
    }

    pub fn set_cue_enabled(&mut self, enabled: bool) {
        self.cue_enabled = enabled;
    }

    pub fn position_ratio(&self) -> f32 {
        let seekable_frames = self.seekable_frames();
        if seekable_frames == 0 {
            return 0.0;
        }
        (self.played_frames as f64 / seekable_frames as f64).clamp(0.0, 1.0) as f32
    }

    pub fn cue_enabled(&self) -> bool {
        self.cue_enabled
    }

    pub fn next_frame(&mut self) -> Option<[f32; 2]> {
        self.drain_decoder_messages();

        if !self.playing {
            return None;
        }

        let Some(sample) = self.buffer.get(self.played_frames as usize).copied() else {
            if self.decoder_finished {
                self.playing = false;
            }
            return None;
        };

        self.played_frames += 1;
        let sample = self.filter.process(sample);
        Some([sample[0] * self.volume, sample[1] * self.volume])
    }

    fn drain_decoder_messages(&mut self) {
        let Some(decoder) = &self.decoder else {
            return;
        };

        while let Ok(message) = decoder.try_recv() {
            match message {
                DecodeMessage::Metadata { total_frames } => {
                    self.total_frames = total_frames;
                }
                DecodeMessage::Frames(frames) => {
                    self.decoded_frames += frames.len() as u64;
                    self.buffer.extend(frames);
                }
                DecodeMessage::Finished => {
                    if self.total_frames.is_none() {
                        self.total_frames = Some(self.decoded_frames);
                    }
                    self.decoder_finished = true;
                    self.decoder = None;
                    break;
                }
                DecodeMessage::Error(error) => {
                    self.decoder_error = Some(error);
                    self.decoder_finished = true;
                    self.decoder = None;
                    self.playing = false;
                    break;
                }
            }
        }

        if self.decoder.is_none() && self.played_frames >= self.seekable_frames() {
            self.playing = false;
        }
    }

    fn filter_sample_rate(&self) -> f32 {
        self.filter.sample_rate
    }

    fn seekable_frames(&self) -> u64 {
        self.total_frames.unwrap_or(self.decoded_frames)
    }
}
use std::sync::mpsc::Receiver;

use crate::decoder::DecodeMessage;

#[cfg(test)]
mod tests {
    use super::Deck;

    #[test]
    fn seek_updates_loaded_deck_position() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.0, 0.0]; 100]);

        deck.set_position_ratio(0.42);

        assert!((deck.position_ratio() - 0.42).abs() < 0.01);
    }

    #[test]
    fn seek_clamps_to_loaded_deck_bounds() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.0, 0.0]; 100]);

        deck.set_position_ratio(2.0);
        assert!((deck.position_ratio() - 0.99).abs() < 0.001);

        deck.set_position_ratio(-1.0);
        assert_eq!(deck.position_ratio(), 0.0);
    }

    #[test]
    fn seek_uses_total_stream_length_when_metadata_is_available() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut deck = Deck::new(44_100.0);
        deck.load_stream(receiver);

        sender
            .send(crate::decoder::DecodeMessage::Metadata {
                total_frames: Some(200),
            })
            .expect("send metadata");
        sender
            .send(crate::decoder::DecodeMessage::Frames(vec![[0.0, 0.0]; 50]))
            .expect("send frames");

        deck.set_position_ratio(1.0);

        assert!((deck.position_ratio() - 0.995).abs() < 0.001);
        assert_eq!(deck.played_frames, 199);
    }
}
