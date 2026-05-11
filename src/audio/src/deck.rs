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
    sample_rate: f64,
    playing: bool,
    scrub_active: bool,
    scrub_target_frames: f64,
    scrub_velocity: f64,
    volume: f32,
    cue_enabled: bool,
    filter: DeckFilter,
    eq: ThreeBandEq,
    fx: FxChain,
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
            sample_rate: sample_rate.max(1.0) as f64,
            playing: false,
            scrub_active: false,
            scrub_target_frames: 0.0,
            scrub_velocity: 0.0,
            volume: 1.0,
            cue_enabled: false,
            filter: DeckFilter::new(sample_rate),
            eq: ThreeBandEq::new(sample_rate),
            fx: FxChain::new(sample_rate),
            decoder: None,
            decoder_finished: true,
            decoder_error: None,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0) as f64;
        self.filter.set_sample_rate(sample_rate);
        self.eq.set_sample_rate(sample_rate);
        self.fx.set_sample_rate(sample_rate);
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
        self.fx.clear();
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
        self.fx.clear();
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
        self.scrub_velocity = self.scrub_velocity_for_delta(delta);
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
        self.fx.clear();
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.5);
    }

    pub fn set_tempo_percent(&mut self, tempo_percent: f32) {
        self.playback_rate = (1.0 + tempo_percent.clamp(-100.0, 100.0) as f64 / 100.0).max(0.05);
    }

    pub fn set_playback_rate(&mut self, playback_rate: f64) {
        self.playback_rate = playback_rate.clamp(0.05, 4.0);
    }

    pub fn playback_rate(&self) -> f64 {
        self.playback_rate
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

    pub fn set_fx_chain(&mut self, effects: Vec<DeckFxConfig>) {
        self.fx.set_effects(effects);
    }

    pub fn add_fx(&mut self, effect: DeckFxConfig) {
        self.fx.add_effect(effect);
    }

    pub fn clear_fx(&mut self) {
        self.fx.clear_effects();
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

    pub fn position_frames(&self) -> f64 {
        self.played_frames
    }

    pub fn set_position_frames(&mut self, frames: f64) {
        let max_playable_frame = self.seekable_frames().saturating_sub(1) as f64;
        self.played_frames = frames.clamp(0.0, max_playable_frame);
        self.filter.clear();
        self.eq.clear();
        self.fx.clear();
    }

    pub fn total_seconds(&self) -> f64 {
        self.seekable_frames() as f64 / self.sample_rate.max(1.0)
    }

    pub fn position_seconds(&self) -> f64 {
        self.position_frames() / self.sample_rate.max(1.0)
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate.max(1.0)
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
            self.played_frames += self.scrub_velocity;
            self.played_frames = self
                .played_frames
                .clamp(0.0, self.seekable_frames().saturating_sub(1) as f64);
            self.scrub_velocity *= 0.99995;
        } else {
            self.played_frames += self.playback_rate;
        }
        let sample = self.filter.process(sample);
        let sample = self.eq.process(sample);
        let sample = [sample[0] * self.volume, sample[1] * self.volume];
        Some(self.fx.process(sample))
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
                    self.total_frames = Some(self.decoded_frames);
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

    fn scrub_velocity_for_delta(&self, delta_frames: f64) -> f64 {
        let control_interval_frames = self.sample_rate / 60.0;
        (delta_frames / control_interval_frames).clamp(-12.0, 12.0)
    }
}
use std::sync::mpsc::Receiver;

use crate::decoder::DecodeMessage;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DeckFxKind {
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeckFxConfig {
    pub kind: DeckFxKind,
    pub enabled: bool,
    pub mix: f32,
    pub amount: f32,
    pub rate_hz: f32,
    pub feedback: f32,
}

impl DeckFxConfig {
    pub fn echo(mix: f32, delay_ms: f32, feedback: f32) -> Self {
        Self {
            kind: DeckFxKind::Echo,
            enabled: true,
            mix,
            amount: delay_ms,
            rate_hz: 0.0,
            feedback,
        }
    }

    pub fn reverb(mix: f32, size: f32, damping: f32) -> Self {
        Self {
            kind: DeckFxKind::Reverb,
            enabled: true,
            mix,
            amount: size,
            rate_hz: 0.0,
            feedback: damping,
        }
    }

    pub fn crush(mix: f32, depth: f32, downsample: f32) -> Self {
        Self {
            kind: DeckFxKind::Crush,
            enabled: true,
            mix,
            amount: depth,
            rate_hz: downsample,
            feedback: 0.0,
        }
    }

    pub fn flanger(mix: f32, depth: f32, rate_hz: f32, feedback: f32) -> Self {
        Self {
            kind: DeckFxKind::Flanger,
            enabled: true,
            mix,
            amount: depth,
            rate_hz,
            feedback,
        }
    }
}

#[derive(Debug)]
struct FxChain {
    sample_rate: f32,
    effects: Vec<DeckEffect>,
}

impl FxChain {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate: sample_rate.max(1.0),
            effects: Vec::new(),
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        for effect in &mut self.effects {
            effect.set_sample_rate(self.sample_rate);
        }
    }

    fn set_effects(&mut self, effects: Vec<DeckFxConfig>) {
        let mut current = std::mem::take(&mut self.effects).into_iter();
        self.effects = effects
            .into_iter()
            .map(|config| match current.next() {
                Some(mut effect) if effect.kind() == config.kind => {
                    effect.set_config(config);
                    effect
                }
                _ => DeckEffect::new(self.sample_rate, config),
            })
            .collect();
    }

    fn add_effect(&mut self, effect: DeckFxConfig) {
        self.effects.push(DeckEffect::new(self.sample_rate, effect));
    }

    fn clear_effects(&mut self) {
        self.effects.clear();
    }

    fn clear(&mut self) {
        for effect in &mut self.effects {
            effect.clear();
        }
    }

    fn process(&mut self, mut sample: [f32; 2]) -> [f32; 2] {
        for effect in &mut self.effects {
            sample = effect.process(sample);
        }
        sample
    }
}

#[derive(Debug)]
enum DeckEffect {
    Echo(EchoEffect),
    Reverb(ReverbEffect),
    Crush(CrushEffect),
    Flanger(FlangerEffect),
    Spiral(SpiralEffect),
    Delay(DelayEffect),
    Trans(TransEffect),
    Phaser(PhaserEffect),
    Roll(RollEffect),
    SlipRoll(RollEffect),
}

impl DeckEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        match config.kind {
            DeckFxKind::Echo => Self::Echo(EchoEffect::new(sample_rate, config)),
            DeckFxKind::Reverb => Self::Reverb(ReverbEffect::new(sample_rate, config)),
            DeckFxKind::Crush => Self::Crush(CrushEffect::new(config)),
            DeckFxKind::Flanger => Self::Flanger(FlangerEffect::new(sample_rate, config)),
            DeckFxKind::Spiral => Self::Spiral(SpiralEffect::new(sample_rate, config)),
            DeckFxKind::Delay => Self::Delay(DelayEffect::new(sample_rate, config)),
            DeckFxKind::Trans => Self::Trans(TransEffect::new(sample_rate, config)),
            DeckFxKind::Phaser => Self::Phaser(PhaserEffect::new(sample_rate, config)),
            DeckFxKind::Roll => Self::Roll(RollEffect::new(sample_rate, config)),
            DeckFxKind::SlipRoll => Self::SlipRoll(RollEffect::new(sample_rate, config)),
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        match self {
            Self::Echo(effect) => effect.set_sample_rate(sample_rate),
            Self::Reverb(effect) => effect.set_sample_rate(sample_rate),
            Self::Crush(_) => {}
            Self::Flanger(effect) => effect.set_sample_rate(sample_rate),
            Self::Spiral(effect) => effect.set_sample_rate(sample_rate),
            Self::Delay(effect) => effect.set_sample_rate(sample_rate),
            Self::Trans(effect) => effect.set_sample_rate(sample_rate),
            Self::Phaser(effect) => effect.set_sample_rate(sample_rate),
            Self::Roll(effect) => effect.set_sample_rate(sample_rate),
            Self::SlipRoll(effect) => effect.set_sample_rate(sample_rate),
        }
    }

    fn kind(&self) -> DeckFxKind {
        match self {
            Self::Echo(_) => DeckFxKind::Echo,
            Self::Reverb(_) => DeckFxKind::Reverb,
            Self::Crush(_) => DeckFxKind::Crush,
            Self::Flanger(_) => DeckFxKind::Flanger,
            Self::Spiral(_) => DeckFxKind::Spiral,
            Self::Delay(_) => DeckFxKind::Delay,
            Self::Trans(_) => DeckFxKind::Trans,
            Self::Phaser(_) => DeckFxKind::Phaser,
            Self::Roll(_) => DeckFxKind::Roll,
            Self::SlipRoll(_) => DeckFxKind::SlipRoll,
        }
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        match self {
            Self::Echo(effect) => effect.set_config(config),
            Self::Reverb(effect) => effect.set_config(config),
            Self::Crush(effect) => effect.set_config(config),
            Self::Flanger(effect) => effect.set_config(config),
            Self::Spiral(effect) => effect.set_config(config),
            Self::Delay(effect) => effect.set_config(config),
            Self::Trans(effect) => effect.set_config(config),
            Self::Phaser(effect) => effect.set_config(config),
            Self::Roll(effect) => effect.set_config(config),
            Self::SlipRoll(effect) => effect.set_config(config),
        }
    }

    fn clear(&mut self) {
        match self {
            Self::Echo(effect) => effect.clear(),
            Self::Reverb(effect) => effect.clear(),
            Self::Crush(effect) => effect.clear(),
            Self::Flanger(effect) => effect.clear(),
            Self::Spiral(effect) => effect.clear(),
            Self::Delay(effect) => effect.clear(),
            Self::Trans(effect) => effect.clear(),
            Self::Phaser(effect) => effect.clear(),
            Self::Roll(effect) => effect.clear(),
            Self::SlipRoll(effect) => effect.clear(),
        }
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        match self {
            Self::Echo(effect) => effect.process(sample),
            Self::Reverb(effect) => effect.process(sample),
            Self::Crush(effect) => effect.process(sample),
            Self::Flanger(effect) => effect.process(sample),
            Self::Spiral(effect) => effect.process(sample),
            Self::Delay(effect) => effect.process(sample),
            Self::Trans(effect) => effect.process(sample),
            Self::Phaser(effect) => effect.process(sample),
            Self::Roll(effect) => effect.process(sample),
            Self::SlipRoll(effect) => effect.process(sample),
        }
    }
}

#[derive(Debug)]
struct EchoEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    buffer: Vec<[f32; 2]>,
    index: usize,
    hpf_low: OnePoleLowPass,
}

impl EchoEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        let mut effect = Self {
            config,
            sample_rate: sample_rate.max(1.0),
            buffer: Vec::new(),
            index: 0,
            hpf_low: OnePoleLowPass::new(sample_rate),
        };
        effect.resize_buffer();
        effect
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.hpf_low.set_sample_rate(self.sample_rate);
        self.resize_buffer();
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        let old_len = self.buffer.len();
        self.config = config;
        let delay_ms = self.config.amount.clamp(15.0, 2_000.0);
        let next_len = ((self.sample_rate * delay_ms) / 1_000.0).round().max(1.0) as usize;
        if next_len.abs_diff(old_len) > 2 {
            self.resize_buffer();
        }
    }

    fn resize_buffer(&mut self) {
        let delay_ms = self.config.amount.clamp(15.0, 2_000.0);
        let len = ((self.sample_rate * delay_ms) / 1_000.0).round().max(1.0) as usize;
        self.buffer = vec![[0.0, 0.0]; len];
        self.index = 0;
    }

    fn clear(&mut self) {
        self.buffer.fill([0.0, 0.0]);
        self.hpf_low.clear();
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled || self.buffer.is_empty() {
            return sample;
        }
        let delayed = self.buffer[self.index];
        self.hpf_low
            .set_cutoff_immediate(map_fx_hpf_cutoff(self.config.rate_hz));
        let delayed = high_pass(&mut self.hpf_low, delayed);
        let mix = self.config.mix.clamp(0.0, 1.0);
        let feedback = (self.config.feedback + mix * 0.35).clamp(0.0, 0.86);
        self.buffer[self.index] = [
            sample[0] + delayed[0] * feedback,
            sample[1] + delayed[1] * feedback,
        ];
        self.index = (self.index + 1) % self.buffer.len();
        wet_mix(sample, delayed, mix)
    }
}

#[derive(Debug)]
struct ReverbEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    combs: Vec<CombFilter>,
    allpass_l: DelayLine,
    allpass_r: DelayLine,
    wet_hpf_low: OnePoleLowPass,
}

impl ReverbEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        let mut effect = Self {
            config,
            sample_rate: sample_rate.max(1.0),
            combs: Vec::new(),
            allpass_l: DelayLine::new(1),
            allpass_r: DelayLine::new(1),
            wet_hpf_low: OnePoleLowPass::new(sample_rate),
        };
        effect.rebuild();
        effect
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.wet_hpf_low.set_sample_rate(self.sample_rate);
        self.rebuild();
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        let old_amount = self.config.amount;
        self.config = config;
        if (self.config.amount - old_amount).abs() > 0.08 {
            self.rebuild();
        }
    }

    fn rebuild(&mut self) {
        let size = self.config.amount.clamp(0.0, 1.0);
        let scale = 0.65 + size * 1.6;
        let delays_ms = [29.7, 37.1, 41.1, 43.7, 53.3, 61.7];
        self.combs = delays_ms
            .iter()
            .map(|delay| CombFilter::new(((self.sample_rate * delay * scale) / 1_000.0) as usize))
            .collect();
        self.allpass_l = DelayLine::new(((self.sample_rate * 5.0 * scale) / 1_000.0) as usize);
        self.allpass_r = DelayLine::new(((self.sample_rate * 6.1 * scale) / 1_000.0) as usize);
    }

    fn clear(&mut self) {
        for comb in &mut self.combs {
            comb.clear();
        }
        self.allpass_l.clear();
        self.allpass_r.clear();
        self.wet_hpf_low.clear();
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled {
            return sample;
        }
        self.wet_hpf_low
            .set_cutoff_immediate(map_fx_hpf_cutoff(self.config.rate_hz));
        let feedback = 0.62 + self.config.amount.clamp(0.0, 1.0) * 0.26;
        let damping = (0.15 + self.config.feedback.clamp(0.0, 1.0) * 0.55).clamp(0.0, 0.8);
        let early_gain = 0.12 + self.config.amount.clamp(0.0, 1.0) * 0.14;
        let mut wet = [sample[0] * early_gain, sample[1] * early_gain];
        for comb in &mut self.combs {
            let output = comb.process(sample, feedback, damping);
            wet[0] += output[0];
            wet[1] += output[1];
        }
        let gain = 1.0 / self.combs.len().max(1) as f32;
        wet = [wet[0] * gain, wet[1] * gain];
        wet[0] = allpass_process(&mut self.allpass_l, wet[0], 0.5);
        wet[1] = allpass_process(&mut self.allpass_r, wet[1], 0.5);
        wet = high_pass(&mut self.wet_hpf_low, wet);
        wet_mix(sample, wet, self.config.mix)
    }
}

#[derive(Debug)]
struct CrushEffect {
    config: DeckFxConfig,
    held: [f32; 2],
    hold_counter: usize,
}

impl CrushEffect {
    fn new(config: DeckFxConfig) -> Self {
        Self {
            config,
            held: [0.0, 0.0],
            hold_counter: 0,
        }
    }

    fn clear(&mut self) {
        self.held = [0.0, 0.0];
        self.hold_counter = 0;
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        self.config = config;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled {
            return sample;
        }
        let hold = (1.0 + self.config.rate_hz.clamp(0.0, 1.0) * 31.0).round() as usize;
        if self.hold_counter == 0 {
            let bits = (16.0 - self.config.amount.clamp(0.0, 1.0) * 12.0)
                .round()
                .max(2.0);
            let steps = (2.0_f32).powf(bits - 1.0);
            self.held = [
                (sample[0] * steps).round() / steps,
                (sample[1] * steps).round() / steps,
            ];
        }
        self.hold_counter = (self.hold_counter + 1) % hold;
        wet_mix(sample, self.held, self.config.mix)
    }
}

#[derive(Debug)]
struct FlangerEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    buffer: Vec<[f32; 2]>,
    index: usize,
    phase: f32,
}

impl FlangerEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        let mut effect = Self {
            config,
            sample_rate: sample_rate.max(1.0),
            buffer: Vec::new(),
            index: 0,
            phase: 0.0,
        };
        effect.resize_buffer();
        effect
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.resize_buffer();
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        self.config = config;
    }

    fn resize_buffer(&mut self) {
        self.buffer = vec![[0.0, 0.0]; ((self.sample_rate * 0.025) as usize).max(2)];
        self.index = 0;
    }

    fn clear(&mut self) {
        self.buffer.fill([0.0, 0.0]);
        self.phase = 0.0;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled || self.buffer.is_empty() {
            return sample;
        }
        let rate = self.config.rate_hz.clamp(0.01, 8.0);
        let depth_ms = 0.5 + self.config.amount.clamp(0.0, 1.0) * 8.5;
        let base_ms = 1.0;
        let lfo = (self.phase * std::f32::consts::TAU).sin() * 0.5 + 0.5;
        let delay_frames = ((base_ms + depth_ms * lfo) * self.sample_rate / 1_000.0)
            .round()
            .clamp(1.0, (self.buffer.len() - 1) as f32) as usize;
        let read = (self.index + self.buffer.len() - delay_frames) % self.buffer.len();
        let delayed = self.buffer[read];
        let feedback = self.config.feedback.clamp(-0.95, 0.95);
        self.buffer[self.index] = [
            sample[0] + delayed[0] * feedback,
            sample[1] + delayed[1] * feedback,
        ];
        self.index = (self.index + 1) % self.buffer.len();
        self.phase = (self.phase + rate / self.sample_rate) % 1.0;
        wet_mix(sample, delayed, self.config.mix)
    }
}

#[derive(Debug)]
struct DelayEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    buffer: Vec<[f32; 2]>,
    index: usize,
    hpf_low: OnePoleLowPass,
}

impl DelayEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        let mut effect = Self {
            config,
            sample_rate: sample_rate.max(1.0),
            buffer: Vec::new(),
            index: 0,
            hpf_low: OnePoleLowPass::new(sample_rate),
        };
        effect.resize_buffer();
        effect
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.hpf_low.set_sample_rate(self.sample_rate);
        self.resize_buffer();
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        let old_len = self.buffer.len();
        self.config = config;
        let next_len = delay_len(self.sample_rate, self.config.amount);
        if next_len.abs_diff(old_len) > 2 {
            self.resize_buffer();
        }
    }

    fn resize_buffer(&mut self) {
        self.buffer = vec![[0.0, 0.0]; delay_len(self.sample_rate, self.config.amount)];
        self.index = 0;
    }

    fn clear(&mut self) {
        self.buffer.fill([0.0, 0.0]);
        self.hpf_low.clear();
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled || self.buffer.is_empty() {
            return sample;
        }
        let delayed = self.buffer[self.index];
        self.hpf_low
            .set_cutoff_immediate(map_fx_hpf_cutoff(self.config.rate_hz));
        let delayed = high_pass(&mut self.hpf_low, delayed);
        let feedback = self.config.feedback.clamp(0.0, 0.65);
        self.buffer[self.index] = [
            sample[0] + delayed[0] * feedback,
            sample[1] + delayed[1] * feedback,
        ];
        self.index = (self.index + 1) % self.buffer.len();
        wet_mix(sample, delayed, self.config.mix)
    }
}

#[derive(Debug)]
struct SpiralEffect {
    delay: DelayEffect,
    phase: f32,
}

impl SpiralEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        Self {
            delay: DelayEffect::new(sample_rate, config),
            phase: 0.0,
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.delay.set_sample_rate(sample_rate);
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        self.delay.set_config(config);
    }

    fn clear(&mut self) {
        self.delay.clear();
        self.phase = 0.0;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.delay.config.enabled || self.delay.buffer.is_empty() {
            return sample;
        }
        let delayed = self.delay.buffer[self.delay.index];
        let tone = (self.phase * std::f32::consts::TAU).sin() * 0.08;
        let cross = [
            delayed[0] * (1.0 - tone.abs()) - delayed[1] * tone,
            delayed[1] * (1.0 - tone.abs()) + delayed[0] * tone,
        ];
        self.delay
            .hpf_low
            .set_cutoff_immediate(map_fx_hpf_cutoff(self.delay.config.rate_hz));
        let wet = high_pass(&mut self.delay.hpf_low, cross);
        let feedback =
            (0.35 + self.delay.config.feedback + self.delay.config.mix * 0.25).clamp(0.0, 0.92);
        self.delay.buffer[self.delay.index] =
            [sample[0] + wet[0] * feedback, sample[1] + wet[1] * feedback];
        self.delay.index = (self.delay.index + 1) % self.delay.buffer.len();
        self.phase = (self.phase + 0.0007) % 1.0;
        wet_mix(sample, wet, self.delay.config.mix)
    }
}

#[derive(Debug)]
struct TransEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    phase: f32,
}

impl TransEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        Self {
            config,
            sample_rate: sample_rate.max(1.0),
            phase: 0.0,
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        self.config = config;
    }

    fn clear(&mut self) {
        self.phase = 0.0;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled {
            return sample;
        }
        let rate = self.config.rate_hz.clamp(0.05, 64.0);
        let width = (0.15 + self.config.amount.clamp(0.0, 1.0) * 0.7).clamp(0.05, 0.95);
        let gate = if self.phase < width { 1.0 } else { 0.0 };
        let shaped = [sample[0] * gate, sample[1] * gate];
        self.phase = (self.phase + rate / self.sample_rate) % 1.0;
        wet_mix(sample, shaped, self.config.mix)
    }
}

#[derive(Debug)]
struct PhaserEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    phase: f32,
    stages_l: [AllPassStage; 4],
    stages_r: [AllPassStage; 4],
    feedback_l: f32,
    feedback_r: f32,
}

impl PhaserEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        Self {
            config,
            sample_rate: sample_rate.max(1.0),
            phase: 0.0,
            stages_l: [AllPassStage::new(); 4],
            stages_r: [AllPassStage::new(); 4],
            feedback_l: 0.0,
            feedback_r: 0.0,
        }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        self.config = config;
    }

    fn clear(&mut self) {
        self.phase = 0.0;
        self.stages_l = [AllPassStage::new(); 4];
        self.stages_r = [AllPassStage::new(); 4];
        self.feedback_l = 0.0;
        self.feedback_r = 0.0;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled {
            return sample;
        }
        let rate = self.config.rate_hz.clamp(0.02, 8.0);
        let depth = self.config.amount.clamp(0.0, 1.0);
        let lfo_l = (self.phase * std::f32::consts::TAU).sin() * 0.5 + 0.5;
        let lfo_r = ((self.phase + 0.25) * std::f32::consts::TAU).sin() * 0.5 + 0.5;
        let coeff_l = 0.2 + lfo_l * depth * 0.72;
        let coeff_r = 0.2 + lfo_r * depth * 0.72;
        let feedback = self.config.feedback.clamp(0.0, 0.85);
        let mut left = sample[0] + self.feedback_l * feedback;
        let mut right = sample[1] + self.feedback_r * feedback;
        for stage in &mut self.stages_l {
            left = stage.process(left, coeff_l);
        }
        for stage in &mut self.stages_r {
            right = stage.process(right, coeff_r);
        }
        self.feedback_l = left;
        self.feedback_r = right;
        self.phase = (self.phase + rate / self.sample_rate) % 1.0;
        wet_mix(sample, [left, right], self.config.mix)
    }
}

#[derive(Debug)]
struct RollEffect {
    config: DeckFxConfig,
    sample_rate: f32,
    buffer: Vec<[f32; 2]>,
    write_index: usize,
    read_index: usize,
    filled: bool,
}

impl RollEffect {
    fn new(sample_rate: f32, config: DeckFxConfig) -> Self {
        let mut effect = Self {
            config,
            sample_rate: sample_rate.max(1.0),
            buffer: Vec::new(),
            write_index: 0,
            read_index: 0,
            filled: false,
        };
        effect.resize_buffer();
        effect
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.resize_buffer();
    }

    fn set_config(&mut self, config: DeckFxConfig) {
        let old_len = self.buffer.len();
        self.config = config;
        let next_len = delay_len(self.sample_rate, self.config.amount);
        if next_len.abs_diff(old_len) > 2 {
            self.resize_buffer();
        }
    }

    fn resize_buffer(&mut self) {
        self.buffer = vec![[0.0, 0.0]; delay_len(self.sample_rate, self.config.amount)];
        self.write_index = 0;
        self.read_index = 0;
        self.filled = false;
    }

    fn clear(&mut self) {
        self.buffer.fill([0.0, 0.0]);
        self.write_index = 0;
        self.read_index = 0;
        self.filled = false;
    }

    fn process(&mut self, sample: [f32; 2]) -> [f32; 2] {
        if !self.config.enabled || self.buffer.is_empty() {
            return sample;
        }
        if !self.filled {
            self.buffer[self.write_index] = sample;
            self.write_index += 1;
            if self.write_index >= self.buffer.len() {
                self.write_index = 0;
                self.read_index = 0;
                self.filled = true;
            }
            return sample;
        }
        let rolled = self.buffer[self.read_index];
        self.read_index = (self.read_index + 1) % self.buffer.len();
        wet_mix(sample, rolled, self.config.mix)
    }
}

#[derive(Debug)]
struct CombFilter {
    delay: DelayLine,
    last: [f32; 2],
}

impl CombFilter {
    fn new(len: usize) -> Self {
        Self {
            delay: DelayLine::new(len),
            last: [0.0, 0.0],
        }
    }

    fn clear(&mut self) {
        self.delay.clear();
        self.last = [0.0, 0.0];
    }

    fn process(&mut self, input: [f32; 2], feedback: f32, damping: f32) -> [f32; 2] {
        let delayed = self.delay.read();
        self.last = [
            delayed[0] * (1.0 - damping) + self.last[0] * damping,
            delayed[1] * (1.0 - damping) + self.last[1] * damping,
        ];
        self.delay.write([
            input[0] + self.last[0] * feedback,
            input[1] + self.last[1] * feedback,
        ]);
        delayed
    }
}

#[derive(Debug)]
struct DelayLine {
    buffer: Vec<[f32; 2]>,
    index: usize,
}

#[derive(Debug, Clone, Copy)]
struct AllPassStage {
    x1: f32,
    y1: f32,
}

impl AllPassStage {
    const fn new() -> Self {
        Self { x1: 0.0, y1: 0.0 }
    }

    fn process(&mut self, input: f32, coefficient: f32) -> f32 {
        let coefficient = coefficient.clamp(0.0, 0.98);
        let output = -coefficient * input + self.x1 + coefficient * self.y1;
        self.x1 = input;
        self.y1 = output;
        output
    }
}

impl DelayLine {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![[0.0, 0.0]; len.max(1)],
            index: 0,
        }
    }

    fn clear(&mut self) {
        self.buffer.fill([0.0, 0.0]);
        self.index = 0;
    }

    fn read(&self) -> [f32; 2] {
        self.buffer[self.index]
    }

    fn write(&mut self, sample: [f32; 2]) {
        self.buffer[self.index] = sample;
        self.index = (self.index + 1) % self.buffer.len();
    }
}

fn allpass_process(delay: &mut DelayLine, input: f32, feedback: f32) -> f32 {
    let delayed = delay.read()[0];
    let output = -input + delayed;
    delay.write([input + delayed * feedback, input + delayed * feedback]);
    output
}

fn high_pass(low_pass: &mut OnePoleLowPass, sample: [f32; 2]) -> [f32; 2] {
    let low = low_pass.process(sample);
    [sample[0] - low[0], sample[1] - low[1]]
}

fn map_fx_hpf_cutoff(amount: f32) -> f32 {
    let amount = amount.clamp(0.0, 1.0);
    let min = 40.0_f32;
    let max = 2_000.0_f32;
    min * (max / min).powf(amount)
}

fn delay_len(sample_rate: f32, delay_ms: f32) -> usize {
    let delay_ms = delay_ms.clamp(5.0, 4_000.0);
    ((sample_rate.max(1.0) * delay_ms) / 1_000.0)
        .round()
        .max(1.0) as usize
}

fn wet_mix(dry: [f32; 2], wet: [f32; 2], mix: f32) -> [f32; 2] {
    let mix = mix.clamp(0.0, 1.0);
    [
        dry[0] * (1.0 - mix) + wet[0] * mix,
        dry[1] * (1.0 - mix) + wet[1] * mix,
    ]
}

#[cfg(test)]
mod tests {
    use super::{Deck, DeckFilter, DeckFxConfig};

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
    fn finished_stream_uses_actual_decoded_length_over_metadata() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut deck = Deck::new(44_100.0);
        deck.load_stream(receiver);

        sender
            .send(crate::decoder::DecodeMessage::Metadata {
                total_frames: Some(200),
            })
            .expect("send metadata");
        sender
            .send(crate::decoder::DecodeMessage::Frames(vec![[0.0, 0.0]; 100]))
            .expect("send frames");
        sender
            .send(crate::decoder::DecodeMessage::Finished)
            .expect("finish decode");

        deck.set_position_ratio(1.0);

        assert!((deck.total_seconds() - (100.0 / 44_100.0)).abs() < f64::EPSILON);
        assert_eq!(deck.played_frames, 99.0);
    }

    #[test]
    fn tempo_advances_fractional_playhead() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.25, 0.25]; 100]);
        deck.set_tempo_percent(8.0);
        deck.play();

        let frame = deck.next_frame().expect("frame");
        assert!((frame[0] - 0.25).abs() < 0.0001);
        assert!((frame[1] - 0.25).abs() < 0.0001);
        assert!((deck.position_ratio() - 0.0108).abs() < 0.0001);
    }

    #[test]
    fn scrub_moves_with_continuous_velocity() {
        let mut deck = Deck::new(600.0);
        deck.load(vec![[0.25, 0.25]; 1_000]);
        deck.set_position_ratio(0.10);
        deck.start_scrub();
        deck.scrub_to_position_ratio(0.11);

        let before = deck.position_ratio();
        let _ = deck.next_frame();
        let after_one_frame = deck.position_ratio();
        let _ = deck.next_frame();
        let after_two_frames = deck.position_ratio();

        assert!(after_one_frame > before);
        assert!(after_two_frames > after_one_frame);
        assert!(after_one_frame < 0.11);
    }

    #[test]
    fn scrub_keeps_moving_between_control_updates() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.25, 0.25]; 100_000]);
        deck.set_position_ratio(0.10);
        deck.start_scrub();
        deck.scrub_to_position_ratio(0.105);

        let mut previous = deck.position_ratio();
        for _ in 0..1_000 {
            let _ = deck.next_frame();
            let next = deck.position_ratio();
            assert!(next > previous);
            previous = next;
        }
    }

    #[test]
    fn legacy_cutoff_filter_processes_low_pass() {
        let mut filter = DeckFilter::new(44_100.0);
        let sample = [1.0, 1.0];

        filter.set_low_pass_cutoff(60.0);

        assert_ne!(filter.process(sample), sample);
    }

    #[test]
    fn deck_fx_chain_applies_multiple_effects() {
        let mut deck = Deck::new(44_100.0);
        deck.load(vec![[0.5, -0.5]; 4_000]);
        deck.set_fx_chain(vec![
            DeckFxConfig::crush(1.0, 1.0, 0.0),
            DeckFxConfig::flanger(0.6, 0.8, 0.5, 0.2),
        ]);
        deck.play();

        let first = deck.next_frame().expect("frame");
        let later = (0..2_000).filter_map(|_| deck.next_frame()).last().unwrap();

        assert_ne!(first, [0.5, -0.5]);
        assert_ne!(later, first);
    }

    #[test]
    fn echo_repeats_delayed_signal() {
        let mut deck = Deck::new(1_000.0);
        let mut samples = vec![[0.0, 0.0]; 80];
        samples[0] = [1.0, 1.0];
        deck.load(samples);
        deck.set_fx_chain(vec![DeckFxConfig::echo(1.0, 20.0, 0.5)]);
        deck.play();

        let frames = (0..24)
            .filter_map(|_| deck.next_frame())
            .collect::<Vec<_>>();

        assert!(frames[0][0].abs() < 0.0001);
        assert!(frames.iter().skip(19).any(|frame| frame[0] > 0.4));
    }

    #[test]
    fn echo_tail_survives_channel_volume_cut() {
        let mut deck = Deck::new(1_000.0);
        let samples = vec![[1.0, 1.0]; 80];
        deck.load(samples);
        deck.set_fx_chain(vec![DeckFxConfig::echo(1.0, 20.0, 0.5)]);
        deck.play();

        for _ in 0..8 {
            let _ = deck.next_frame();
        }
        deck.set_volume(0.0);
        let frames = (0..40)
            .filter_map(|_| deck.next_frame())
            .collect::<Vec<_>>();

        assert!(frames.iter().skip(12).any(|frame| frame[0].abs() > 0.01));
    }

    #[test]
    fn reverb_generates_wet_signal() {
        let mut deck = Deck::new(1_000.0);
        let mut samples = vec![[0.0, 0.0]; 120];
        samples[0] = [1.0, 1.0];
        deck.load(samples);
        deck.set_fx_chain(vec![DeckFxConfig::reverb(1.0, 0.8, 0.2)]);
        deck.play();

        let frames = (0..80)
            .filter_map(|_| deck.next_frame())
            .collect::<Vec<_>>();

        assert!(frames.iter().skip(20).any(|frame| frame[0].abs() > 0.01));
    }

    #[test]
    fn reverb_has_immediate_early_reflection() {
        let mut deck = Deck::new(1_000.0);
        let mut samples = vec![[0.0, 0.0]; 40];
        samples[0] = [1.0, 1.0];
        deck.load(samples);
        deck.set_fx_chain(vec![DeckFxConfig::reverb(1.0, 0.8, 0.2)]);
        deck.play();

        let first = deck.next_frame().expect("frame");

        assert!(first[0].abs() > 0.001);
    }
}
