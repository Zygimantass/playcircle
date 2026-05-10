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

    pub fn clear(&mut self) {
        self.left = 0.0;
        self.right = 0.0;
    }

    pub fn set_cutoff(&mut self, cutoff_hz: f32) {
        self.target_cutoff_hz = cutoff_hz.clamp(60.0, 20_000.0);
    }

    pub fn set_cutoff_immediate(&mut self, cutoff_hz: f32) {
        let cutoff_hz = cutoff_hz.clamp(60.0, 20_000.0);
        self.current_cutoff_hz = cutoff_hz;
        self.target_cutoff_hz = cutoff_hz;
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

#[derive(Debug, Clone, Copy)]
struct DeckFilter {
    amount: f32,
    low_pass: OnePoleLowPass,
    high_pass_low: OnePoleLowPass,
}

impl DeckFilter {
    fn new(sample_rate: f32) -> Self {
        Self {
            amount: 0.0,
            low_pass: OnePoleLowPass::new(sample_rate),
            high_pass_low: OnePoleLowPass::new(sample_rate),
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.low_pass.set_sample_rate(sample_rate);
        self.high_pass_low.set_sample_rate(sample_rate);
    }

    fn clear(&mut self) {
        self.low_pass.clear();
        self.high_pass_low.clear();
    }

    fn set_amount(&mut self, amount: f32) {
        self.amount = amount.clamp(-1.0, 1.0);
        if self.amount < 0.0 {
            self.low_pass.set_cutoff(map_low_pass_cutoff(-self.amount));
        } else if self.amount > 0.0 {
            self.high_pass_low
                .set_cutoff(map_high_pass_cutoff(self.amount));
        }
    }

    fn set_low_pass_cutoff(&mut self, cutoff_hz: f32) {
        self.amount = -1.0;
        self.low_pass.set_cutoff(cutoff_hz);
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if self.amount < -0.001 {
            self.low_pass.process(sample)
        } else if self.amount > 0.001 {
            let low = self.high_pass_low.process(sample);
            [sample[0] - low[0], sample[1] - low[1]]
        } else {
            sample
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ThreeBandEq {
    low_gain: f32,
    mid_gain: f32,
    high_gain: f32,
    low_split: OnePoleLowPass,
    high_split: OnePoleLowPass,
}

impl ThreeBandEq {
    fn new(sample_rate: f32) -> Self {
        let mut low_split = OnePoleLowPass::new(sample_rate);
        low_split.set_cutoff_immediate(250.0);
        let mut high_split = OnePoleLowPass::new(sample_rate);
        high_split.set_cutoff_immediate(4_000.0);

        Self {
            low_gain: 1.0,
            mid_gain: 1.0,
            high_gain: 1.0,
            low_split,
            high_split,
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.low_split.set_sample_rate(sample_rate);
        self.high_split.set_sample_rate(sample_rate);
    }

    fn clear(&mut self) {
        self.low_split.clear();
        self.high_split.clear();
    }

    fn set_gains(&mut self, high: f32, mid: f32, low: f32) {
        self.high_gain = eq_gain(high);
        self.mid_gain = eq_gain(mid);
        self.low_gain = eq_gain(low);
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        let low = self.low_split.process(sample);
        let high_base = self.high_split.process(sample);
        let high = [sample[0] - high_base[0], sample[1] - high_base[1]];
        let mid = [sample[0] - low[0] - high[0], sample[1] - low[1] - high[1]];

        [
            low[0] * self.low_gain + mid[0] * self.mid_gain + high[0] * self.high_gain,
            low[1] * self.low_gain + mid[1] * self.mid_gain + high[1] * self.high_gain,
        ]
    }
}

fn eq_gain(value: f32) -> f32 {
    let value = value.clamp(-1.0, 1.0);
    1.0 + value
}

fn map_low_pass_cutoff(amount: f32) -> f32 {
    let amount = amount.clamp(0.0, 1.0);
    let min = 80.0_f32;
    let max = 18_000.0_f32;
    min * (max / min).powf(1.0 - amount)
}

fn map_high_pass_cutoff(amount: f32) -> f32 {
    let amount = amount.clamp(0.0, 1.0);
    let min = 80.0_f32;
    let max = 18_000.0_f32;
    min * (max / min).powf(amount)
}

#[derive(Debug)]
pub struct Deck {
    buffer: Vec<[f32; 2]>,
    decoded_frames: u64,
    total_frames: Option<u64>,
    played_frames: f64,
    playback_rate: f64,
    playing: bool,
    scrub_active: bool,
    scrub_target_frames: f64,
    scrub_velocity: f64,
    volume: f32,
    cue_enabled: bool,
    filter: DeckFilter,
    eq: ThreeBandEq,
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
            played_frames: 0.0,
            playback_rate: 1.0,
            playing: false,
            scrub_active: false,
            scrub_target_frames: 0.0,
            scrub_velocity: 0.0,
            volume: 0.85,
            cue_enabled: false,
            filter: DeckFilter::new(sample_rate),
            eq: ThreeBandEq::new(sample_rate),
            decoder: None,
            decoder_finished: true,
            decoder_error: None,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.filter.set_sample_rate(sample_rate);
        self.eq.set_sample_rate(sample_rate);
    }

    pub fn load(&mut self, samples: Vec<[f32; 2]>) {
        self.buffer = samples;
        self.decoded_frames = self.buffer.len() as u64;
        self.total_frames = Some(self.decoded_frames);
        self.played_frames = 0.0;
        self.scrub_active = false;
        self.scrub_target_frames = 0.0;
        self.scrub_velocity = 0.0;
        self.playing = false;
        self.filter.clear();
        self.eq.clear();
        self.decoder = None;
        self.decoder_finished = true;
        self.decoder_error = None;
    }

    pub fn load_stream(&mut self, decoder: Receiver<DecodeMessage>) {
        self.buffer.clear();
        self.decoded_frames = 0;
        self.total_frames = None;
        self.played_frames = 0.0;
        self.scrub_active = false;
        self.scrub_target_frames = 0.0;
        self.scrub_velocity = 0.0;
        self.playing = false;
        self.filter.clear();
        self.eq.clear();
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

    pub fn start_scrub(&mut self) {
        self.drain_decoder_messages();
        self.scrub_active = true;
        self.scrub_target_frames = self.played_frames;
        self.scrub_velocity = 0.0;
    }

    pub fn scrub_to_position_ratio(&mut self, ratio: f32) {
        self.drain_decoder_messages();
        let ratio = ratio.clamp(0.0, 1.0);
        let seekable_frames = self.seekable_frames();
        let max_playable_frame = seekable_frames.saturating_sub(1);
        let target_frame = max_playable_frame as f64 * ratio as f64;
        let target_frame = target_frame.min(max_playable_frame as f64);
        let delta = target_frame - self.played_frames;

        self.scrub_active = true;
        self.scrub_target_frames = target_frame;
        self.scrub_velocity = (delta * 0.075).clamp(-24.0, 24.0);
        self.played_frames = target_frame;
    }

    pub fn end_scrub(&mut self) {
        self.scrub_active = false;
        self.scrub_velocity = 0.0;
    }

    pub fn set_position_ratio(&mut self, ratio: f32) {
        self.drain_decoder_messages();
        let ratio = ratio.clamp(0.0, 1.0);
        let seekable_frames = self.seekable_frames();
        let max_playable_frame = seekable_frames.saturating_sub(1);
        let target_frame = max_playable_frame as f64 * ratio as f64;
        self.played_frames = target_frame.min(max_playable_frame as f64);
        self.filter.clear();
        self.eq.clear();
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.5);
    }

    pub fn set_tempo_percent(&mut self, tempo_percent: f32) {
        self.playback_rate = (1.0 + tempo_percent.clamp(-100.0, 100.0) as f64 / 100.0).max(0.05);
    }

    pub fn set_filter_cutoff(&mut self, cutoff_hz: f32) {
        self.filter.set_low_pass_cutoff(cutoff_hz);
    }

    pub fn set_filter_amount(&mut self, amount: f32) {
        self.filter.set_amount(amount);
    }

    pub fn set_eq(&mut self, high: f32, mid: f32, low: f32) {
        self.eq.set_gains(high, mid, low);
    }

    pub fn set_cue_enabled(&mut self, enabled: bool) {
        self.cue_enabled = enabled;
    }

    pub fn position_ratio(&self) -> f32 {
        let seekable_frames = self.seekable_frames();
        if seekable_frames == 0 {
            return 0.0;
        }
        (self.played_frames / seekable_frames as f64).clamp(0.0, 1.0) as f32
    }

    pub fn cue_enabled(&self) -> bool {
        self.cue_enabled
    }

    pub fn decoder_error(&self) -> Option<&str> {
        self.decoder_error.as_deref()
    }

    pub fn next_frame(&mut self) -> Option<[f32; 2]> {
        self.drain_decoder_messages();

        if !self.playing && !self.scrub_active {
            return None;
        }

        let frame_index = self.played_frames.floor() as usize;
        let Some(current) = self.buffer.get(frame_index).copied() else {
            if self.decoder_finished {
                self.playing = false;
            }
            return None;
        };
        let next = self.buffer.get(frame_index + 1).copied().unwrap_or(current);
        let fraction = (self.played_frames - frame_index as f64) as f32;
        let sample = [
            current[0] + (next[0] - current[0]) * fraction,
            current[1] + (next[1] - current[1]) * fraction,
        ];

        if self.scrub_active && !self.playing {
            let distance = self.scrub_target_frames - self.played_frames;
            if distance.abs() > 0.5 {
                self.played_frames += distance.clamp(-24.0, 24.0);
            } else {
                self.played_frames += self.scrub_velocity;
            }
            self.played_frames = self
                .played_frames
                .clamp(0.0, self.seekable_frames().saturating_sub(1) as f64);
            self.scrub_velocity *= 0.992;
        } else {
            self.played_frames += self.playback_rate;
        }
        let sample = self.filter.process(sample);
        let sample = self.eq.process(sample);
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

        if self.decoder.is_none() && self.played_frames >= self.seekable_frames() as f64 {
            self.playing = false;
        }
    }

    fn seekable_frames(&self) -> u64 {
        self.total_frames.unwrap_or(self.decoded_frames)
    }
}
use std::sync::mpsc::Receiver;

use crate::decoder::DecodeMessage;

#[cfg(test)]
mod tests {
    use super::{Deck, DeckFilter};

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
        assert_eq!(deck.played_frames, 199.0);
    }

    #[test]
    fn tempo_advances_fractional_playhead() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.25, 0.25]; 100]);
        deck.set_tempo_percent(8.0);
        deck.play();

        let frame = deck.next_frame().expect("frame");
        assert!((frame[0] - 0.2125).abs() < 0.0001);
        assert!((frame[1] - 0.2125).abs() < 0.0001);
        assert!((deck.position_ratio() - 0.0108).abs() < 0.0001);
    }

    #[test]
    fn legacy_cutoff_filter_processes_low_pass() {
        let mut filter = DeckFilter::new(44_100.0);
        let sample = [1.0, 1.0];

        filter.set_low_pass_cutoff(60.0);

        assert_ne!(filter.process(sample), sample);
    }
}
