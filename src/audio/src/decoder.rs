use std::fs::File;
use std::path::Path;
use std::sync::mpsc::Sender;

use symphonia::core::audio::{AudioBufferRef, SampleBuffer, SignalSpec};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub fn validate_file(path: &Path) -> Result<(), String> {
    let file =
        File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe {}: {error}", path.display()))?;

    let track = probed
        .format
        .default_track()
        .ok_or_else(|| format!("no default audio track in {}", path.display()))?;

    symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to create decoder for {}: {error}", path.display()))?;

    Ok(())
}

pub fn decode_file(path: &Path, target_sample_rate: u32) -> Result<Vec<[f32; 2]>, String> {
    let file =
        File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe {}: {error}", path.display()))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| format!("no default audio track in {}", path.display()))?;
    let source_sample_rate = track.codec_params.sample_rate.unwrap_or(target_sample_rate);
    let total_frames = track
        .codec_params
        .n_frames
        .map(|frames| resampled_frame_count(frames, source_sample_rate, target_sample_rate));
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to create decoder for {}: {error}", path.display()))?;
    let track_id = track.id;
    let mut output = Vec::<[f32; 2]>::new();
    if let Some(total_frames) = total_frames {
        output.reserve(total_frames.min(usize::MAX as u64) as usize);
    }

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(Error::ResetRequired) => {
                return Err("audio format reset is not supported yet".to_string())
            }
            Err(error) => return Err(format!("failed to read audio packet: {error}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(format!("failed to decode audio packet: {error}")),
        };

        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;
        let mut buffer = SampleBuffer::<f32>::new(duration, spec);
        copy_to_sample_buffer(&mut buffer, decoded);
        append_stereo_frames(&buffer, spec, &mut output);
    }

    if source_sample_rate == target_sample_rate {
        Ok(output)
    } else {
        Ok(resample_linear(
            &output,
            source_sample_rate,
            target_sample_rate,
        ))
    }
}

pub enum DecodeMessage {
    Metadata { total_frames: Option<u64> },
    Frames(Vec<[f32; 2]>),
    Finished,
    Error(String),
}

pub fn decode_file_to_sender(
    path: &Path,
    target_sample_rate: u32,
    sender: Sender<DecodeMessage>,
) -> Result<(), String> {
    let file =
        File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe {}: {error}", path.display()))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| format!("no default audio track in {}", path.display()))?;
    let source_sample_rate = track.codec_params.sample_rate.unwrap_or(target_sample_rate);
    let total_frames = track
        .codec_params
        .n_frames
        .map(|frames| resampled_frame_count(frames, source_sample_rate, target_sample_rate));
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to create decoder for {}: {error}", path.display()))?;
    let track_id = track.id;

    let _ = sender.send(DecodeMessage::Metadata { total_frames });

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                let _ = sender.send(DecodeMessage::Finished);
                break;
            }
            Err(Error::ResetRequired) => {
                return Err("audio format reset is not supported yet".to_string())
            }
            Err(error) => return Err(format!("failed to read audio packet: {error}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(format!("failed to decode audio packet: {error}")),
        };

        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;
        let mut buffer = SampleBuffer::<f32>::new(duration, spec);
        copy_to_sample_buffer(&mut buffer, decoded);

        let mut frames = Vec::with_capacity(buffer.samples().len() / spec.channels.count().max(1));
        append_stereo_frames(&buffer, spec, &mut frames);
        if source_sample_rate != target_sample_rate {
            frames = resample_linear(&frames, source_sample_rate, target_sample_rate);
        }

        if !frames.is_empty() && sender.send(DecodeMessage::Frames(frames)).is_err() {
            break;
        }
    }

    Ok(())
}

fn resampled_frame_count(frames: u64, source_sample_rate: u32, target_sample_rate: u32) -> u64 {
    if source_sample_rate == 0
        || target_sample_rate == 0
        || source_sample_rate == target_sample_rate
    {
        return frames;
    }

    ((frames as f64 * target_sample_rate as f64) / source_sample_rate as f64).ceil() as u64
}

fn copy_to_sample_buffer(buffer: &mut SampleBuffer<f32>, decoded: AudioBufferRef<'_>) {
    buffer.copy_interleaved_ref(decoded);
}

fn append_stereo_frames(buffer: &SampleBuffer<f32>, spec: SignalSpec, output: &mut Vec<[f32; 2]>) {
    let channels = spec.channels.count().max(1);
    for frame in buffer.samples().chunks(channels) {
        let left = frame.first().copied().unwrap_or(0.0);
        let right = frame.get(1).copied().unwrap_or(left);
        output.push([left, right]);
    }
}

fn resample_linear(
    input: &[[f32; 2]],
    source_sample_rate: u32,
    target_sample_rate: u32,
) -> Vec<[f32; 2]> {
    if input.is_empty() || source_sample_rate == 0 || target_sample_rate == 0 {
        return Vec::new();
    }

    let ratio = source_sample_rate as f64 / target_sample_rate as f64;
    let output_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_position = index as f64 * ratio;
        let base = source_position.floor() as usize;
        let frac = (source_position - base as f64) as f32;
        let a = input.get(base).copied().unwrap_or([0.0, 0.0]);
        let b = input.get(base + 1).copied().unwrap_or(a);
        output.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::resample_linear;

    #[test]
    fn resamples_stereo_frames() {
        let input = vec![[0.0, 0.0], [1.0, -1.0], [0.0, 0.0]];
        let output = resample_linear(&input, 3, 6);

        assert_eq!(output.len(), 6);
        assert_eq!(output[0], [0.0, 0.0]);
        assert!(output[1][0] > 0.0);
    }
}
