//! Speech to text on this PC (AC-106): OpenAI's Whisper run on the CPU with candle
//! (pure Rust, no cmake/clang). The model is downloaded once, on request, into the
//! data folder; after that dictation works without internet or an API key.
//!
//! The UI hands over 16 kHz mono WAV (it decodes the recording with WebAudio), so
//! this module only does PCM → log-mel → greedy decoding.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use candle_core::{Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper::{self as m, audio, model::Whisper, Config};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// The provider id the Voz role uses for this engine.
pub const PROVIDER: &str = "local";

/// 80-bin mel filterbank for 16 kHz / n_fft 400 (from candle's whisper example).
const MEL_FILTERS: &[u8] = include_bytes!("../assets/melfilters.bytes");

/// What a recording can last: two Whisper windows, and the decoding stays quick.
pub const MAX_SECONDS: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalModel {
    pub id: &'static str,
    pub label: &'static str,
    repo: &'static str,
    /// Size of model.safetensors, in bytes (shown before downloading).
    pub bytes: u64,
    sha256: &'static str,
}

/// Multilingual only: the `.en` variants can't do Spanish.
pub const MODELS: [LocalModel; 2] = [
    LocalModel { id: "whisper-tiny", label: "Rápido (tiny)", repo: "openai/whisper-tiny", bytes: 151_061_672, sha256: "7ebd0e69e78190ffe1438491fa05cc1f5c1aa3a4c4db3bc1723adbb551ea2395" },
    LocalModel { id: "whisper-base", label: "Mejor (base)", repo: "openai/whisper-base", bytes: 290_403_936, sha256: "07cadb9f25677c8d50df603e66a98fbd842cce45047139baeb16e6219a1e807b" },
];

pub fn model(id: &str) -> Option<&'static LocalModel> {
    MODELS.iter().find(|m| m.id == id)
}

const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

pub fn dir(data_dir: &Path, model: &LocalModel) -> PathBuf {
    data_dir.join("speech").join(model.id)
}

pub fn installed(data_dir: &Path, model: &LocalModel) -> bool {
    let d = dir(data_dir, model);
    FILES.iter().all(|f| d.join(f).is_file())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub installed: bool,
}

pub fn status(data_dir: &Path) -> Vec<ModelStatus> {
    MODELS.iter().map(|m| ModelStatus { id: m.id.into(), label: m.label.into(), bytes: m.bytes, installed: installed(data_dir, m) }).collect()
}

/// Downloads the three files, checking the weights' sha256, into a temporary folder
/// that only becomes the model folder once everything arrived intact.
pub async fn download(data_dir: &Path, model: &LocalModel, mut progress: impl FnMut(u64, u64)) -> Result<()> {
    use futures_util::StreamExt;
    let target = dir(data_dir, model);
    let tmp = target.with_extension("partial");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let client = reqwest::Client::new();
    let mut done = 0u64;
    for file in FILES {
        let url = format!("https://huggingface.co/{}/resolve/main/{file}", model.repo);
        let resp = client.get(&url).send().await.with_context(|| format!("no se pudo descargar {file}"))?;
        if !resp.status().is_success() {
            bail!("La descarga de {file} respondió {}.", resp.status());
        }
        let mut out = std::fs::File::create(tmp.join(file))?;
        let mut hash = Sha256::new();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("la descarga se cortó")?;
            std::io::Write::write_all(&mut out, &chunk)?;
            hash.update(&chunk);
            done += chunk.len() as u64;
            progress(done, model.bytes);
        }
        let hex: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if file == "model.safetensors" && hex != model.sha256 {
            let _ = std::fs::remove_dir_all(&tmp);
            bail!("El modelo descargado no coincide con el original (archivo dañado). Probá de nuevo.");
        }
    }
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

pub fn remove(data_dir: &Path, model: &LocalModel) -> Result<()> {
    let d = dir(data_dir, model);
    if d.exists() {
        std::fs::remove_dir_all(d)?;
    }
    Ok(())
}

/// Whisper's byte-level BPE, decoding only (the vocabulary of tokenizer.json).
pub struct Tokenizer {
    pieces: HashMap<u32, String>,
    special: HashMap<String, u32>,
    first_special: u32,
}

/// GPT-2's map from the printable characters in the vocabulary back to bytes.
fn byte_decoder() -> HashMap<char, u8> {
    let mut bs: Vec<u32> = (b'!' as u32..=b'~' as u32).chain(0xA1..=0xAC).chain(0xAE..=0xFF).collect();
    let mut cs = bs.clone();
    let mut n = 0;
    for b in 0..256u32 {
        if !bs.contains(&b) {
            bs.push(b);
            cs.push(256 + n);
            n += 1;
        }
    }
    bs.into_iter().zip(cs).map(|(b, c)| (char::from_u32(c).unwrap(), b as u8)).collect()
}

impl Tokenizer {
    pub fn from_json(text: &str) -> Result<Self> {
        let v: serde_json::Value = serde_json::from_str(text).context("tokenizer.json inválido")?;
        let mut pieces = HashMap::new();
        for (piece, id) in v.pointer("/model/vocab").and_then(|x| x.as_object()).ok_or_else(|| anyhow!("tokenizer.json sin vocabulario"))? {
            if let Some(id) = id.as_u64() {
                pieces.insert(id as u32, piece.clone());
            }
        }
        let mut special = HashMap::new();
        for t in v["added_tokens"].as_array().into_iter().flatten() {
            if let (Some(id), Some(content)) = (t["id"].as_u64(), t["content"].as_str()) {
                special.insert(content.to_string(), id as u32);
            }
        }
        let first_special = special.values().copied().min().unwrap_or(u32::MAX);
        Ok(Self { pieces, special, first_special })
    }

    pub fn id(&self, token: &str) -> Result<u32> {
        self.special.get(token).copied().ok_or_else(|| anyhow!("falta el token {token} en el modelo"))
    }

    /// Text of the ordinary tokens; special ones (<|…|>) are skipped.
    pub fn decode(&self, ids: &[u32]) -> String {
        let map = byte_decoder();
        let bytes: Vec<u8> = ids
            .iter()
            .filter(|&&id| id < self.first_special)
            .filter_map(|id| self.pieces.get(id))
            .flat_map(|p| p.chars().filter_map(|c| map.get(&c).copied()).collect::<Vec<_>>())
            .collect();
        String::from_utf8_lossy(&bytes).trim().to_string()
    }
}

/// 16-bit PCM WAV (as the UI sends it) to samples in [-1, 1]. Only mono 16 kHz.
pub fn wav_samples(bytes: &[u8]) -> Result<Vec<f32>> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("La grabación no llegó como WAV.");
    }
    let (mut pos, mut format) = (12, None);
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = &bytes[pos + 8..(pos + 8 + len).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            let channels = u16::from_le_bytes([body[2], body[3]]);
            let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            let bits = u16::from_le_bytes([body[14], body[15]]);
            format = Some((channels, rate, bits));
        } else if id == b"data" {
            match format {
                Some((1, 16000, 16)) => return Ok(body.chunks_exact(2).map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).collect()),
                Some((c, r, b)) => bail!("El audio tiene que ser mono, 16 kHz y 16 bits (llegó {c} canal(es), {r} Hz, {b} bits)."),
                None => bail!("El WAV no dice su formato."),
            }
        }
        pos += 8 + len + (len & 1);
    }
    bail!("El WAV no tiene audio.")
}

/// Whisper language code for the names the app uses ("español", "inglés"…), or a code itself.
pub fn language_code(language: &str) -> Option<&'static str> {
    let l = language.trim().to_lowercase();
    if let Some(code) = crate::language::iso_code(&l) {
        return Some(code);
    }
    Some(match l.as_str() {
        "es" => "es",
        "en" => "en",
        "pt" => "pt",
        "fr" => "fr",
        "de" => "de",
        "it" => "it",
        "japonés" | "japones" | "ja" => "ja",
        "chino" | "zh" => "zh",
        "coreano" | "ko" => "ko",
        "ruso" | "ru" => "ru",
        "catalán" | "catalan" | "ca" => "ca",
        _ => return None,
    })
}

/// A loaded model, kept in memory between dictations.
pub struct Engine {
    pub id: &'static str,
    model: Whisper,
    tokenizer: Tokenizer,
    filters: Vec<f32>,
    suppress: Tensor,
    device: Device,
}

impl Engine {
    pub fn load(data_dir: &Path, info: &'static LocalModel) -> Result<Self> {
        let d = dir(data_dir, info);
        if !installed(data_dir, info) {
            bail!("El modelo de voz local no está descargado. Bajalo en Ajustes → Modelos → Voz.");
        }
        let device = Device::Cpu;
        let config: Config = serde_json::from_str(&std::fs::read_to_string(d.join("config.json"))?).context("config.json inválido")?;
        if config.num_mel_bins != 80 {
            bail!("Este modelo usa {} bandas de mel; solo se admiten 80.", config.num_mel_bins);
        }
        let tokenizer = Tokenizer::from_json(&std::fs::read_to_string(d.join("tokenizer.json"))?)?;
        // SAFETY: the file is ours and isn't modified while mapped.
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[d.join("model.safetensors")], m::DTYPE, &device)? };
        let model = Whisper::load(&vb, config.clone())?;
        let suppress: Vec<f32> = (0..config.vocab_size as u32).map(|i| if config.suppress_tokens.contains(&i) { f32::NEG_INFINITY } else { 0.0 }).collect();
        let suppress = Tensor::new(suppress.as_slice(), &device)?;
        let filters = MEL_FILTERS.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        Ok(Self { id: info.id, model, tokenizer, filters, suppress, device })
    }

    pub fn transcribe(&mut self, samples: &[f32], language: &str) -> Result<String> {
        if samples.len() < m::SAMPLE_RATE / 4 {
            bail!("La grabación es muy corta. Hablá un poco más.");
        }
        if samples.len() > MAX_SECONDS * m::SAMPLE_RATE {
            bail!("La grabación dura más de {MAX_SECONDS} segundos; probá de a partes.");
        }
        let cfg = self.model.config.clone();
        let mel = audio::pcm_to_mel(&cfg, samples, &self.filters);
        let frames = mel.len() / cfg.num_mel_bins;
        let mel = Tensor::from_vec(mel, (1, cfg.num_mel_bins, frames), &self.device)?;
        let content = samples.len() / m::HOP_LENGTH;
        let mut text = Vec::new();
        let mut seek = 0;
        while seek < content {
            let size = (content - seek).min(m::N_FRAMES);
            // The encoder always reads a full 30 s window (the padding is silence).
            let window = mel.narrow(2, seek, m::N_FRAMES.min(frames - seek))?;
            let part = self.decode(&window, language)?;
            if !part.is_empty() {
                text.push(part);
            }
            seek += size;
        }
        let text = text.join(" ");
        if text.trim().is_empty() {
            bail!("No se entendió nada en la grabación. Probá hablar más cerca del micrófono.");
        }
        Ok(text)
    }

    fn decode(&mut self, mel: &Tensor, language: &str) -> Result<String> {
        let t = &self.tokenizer;
        let (sot, transcribe, no_ts, eot) = (t.id(m::SOT_TOKEN)?, t.id(m::TRANSCRIBE_TOKEN)?, t.id(m::NO_TIMESTAMPS_TOKEN)?, t.id(m::EOT_TOKEN)?);
        let features = self.model.encoder.forward(mel, true)?;
        let lang = match language_code(language) {
            Some(code) => t.id(&format!("<|{code}|>"))?,
            None => self.detect_language(&features, sot)?,
        };
        let mut tokens = vec![sot, lang, transcribe, no_ts];
        let prompt = tokens.len();
        let max = self.model.config.max_target_positions / 2;
        for i in 0..max {
            let input = Tensor::new(tokens.as_slice(), &self.device)?.unsqueeze(0)?;
            let ys = self.model.decoder.forward(&input, &features, i == 0)?;
            let (_, len, _) = ys.dims3()?;
            let logits = self.model.decoder.final_linear(&ys.i((..1, len - 1..))?)?.i(0)?.i(0)?;
            let logits: Vec<f32> = logits.broadcast_add(&self.suppress)?.to_vec1()?;
            let next = argmax(&logits);
            if next == eot {
                break;
            }
            tokens.push(next);
            if repeating(&tokens[prompt..]) {
                break;
            }
        }
        Ok(self.tokenizer.decode(&tokens[prompt..]))
    }

    /// Without a known language, Whisper's own guess: the likeliest language token after SOT.
    fn detect_language(&mut self, features: &Tensor, sot: u32) -> Result<u32> {
        let langs: Vec<u32> = self.tokenizer.special.iter().filter(|(k, _)| is_language_token(k)).map(|(_, &v)| v).collect();
        let input = Tensor::new(&[sot], &self.device)?.unsqueeze(0)?;
        let ys = self.model.decoder.forward(&input, features, true)?;
        let logits: Vec<f32> = self.model.decoder.final_linear(&ys.i((..1, 0..1))?)?.i(0)?.i(0)?.to_vec1()?;
        langs.into_iter().max_by(|a, b| logits[*a as usize].total_cmp(&logits[*b as usize])).ok_or_else(|| anyhow!("el modelo no trae idiomas"))
    }
}

fn is_language_token(t: &str) -> bool {
    let inner = t.strip_prefix("<|").and_then(|x| x.strip_suffix("|>")).unwrap_or("");
    (2..=3).contains(&inner.len()) && inner.chars().all(|c| c.is_ascii_lowercase()) || inner == "haw"
}

fn argmax(v: &[f32]) -> u32 {
    v.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i as u32).unwrap_or(0)
}

/// Greedy decoding can loop on a phrase; stop when the last 8 tokens already appeared just before.
fn repeating(tokens: &[u32]) -> bool {
    const N: usize = 8;
    tokens.len() >= 2 * N && tokens[tokens.len() - N..] == tokens[tokens.len() - 2 * N..tokens.len() - N]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(channels: u16, rate: u32, samples: &[i16]) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut v = b"RIFF".to_vec();
        v.extend((36 + data.len() as u32).to_le_bytes());
        v.extend(b"WAVEfmt ");
        v.extend(16u32.to_le_bytes());
        v.extend(1u16.to_le_bytes());
        v.extend(channels.to_le_bytes());
        v.extend(rate.to_le_bytes());
        v.extend((rate * 2 * channels as u32).to_le_bytes());
        v.extend((2 * channels).to_le_bytes());
        v.extend(16u16.to_le_bytes());
        v.extend(b"data");
        v.extend((data.len() as u32).to_le_bytes());
        v.extend(data);
        v
    }

    #[test]
    fn reads_mono_16k_wav_and_refuses_anything_else() {
        assert_eq!(wav_samples(&wav(1, 16000, &[0, 16384, -32768])).unwrap(), vec![0.0, 0.5, -1.0]);
        assert!(wav_samples(&wav(2, 16000, &[0, 0])).unwrap_err().to_string().contains("2 canal(es)"));
        assert!(wav_samples(&wav(1, 44100, &[0])).unwrap_err().to_string().contains("44100 Hz"));
        assert!(wav_samples(b"OggS....").unwrap_err().to_string().contains("WAV"));
        let mut no_data = wav(1, 16000, &[]);
        no_data.truncate(36);
        assert!(wav_samples(&no_data).is_err());
    }

    #[test]
    fn decodes_byte_level_bpe_and_skips_special_tokens() {
        // "Ġ" is the space, "Ã³" are the two UTF-8 bytes of "ó".
        let json = r#"{"model":{"vocab":{"Hola":0,"Ġcanci":1,"Ã³":2,"n":3}},"added_tokens":[{"id":10,"content":"<|endoftext|>"},{"id":11,"content":"<|es|>"}]}"#;
        let t = Tokenizer::from_json(json).unwrap();
        assert_eq!(t.decode(&[11, 0, 1, 2, 3, 10]), "Hola canción");
        assert_eq!(t.id("<|es|>").unwrap(), 11);
        assert!(t.id("<|xx|>").is_err());
        assert!(Tokenizer::from_json("{}").is_err());
    }

    #[test]
    fn maps_the_apps_language_names() {
        assert_eq!(language_code("Español"), Some("es"));
        assert_eq!(language_code("inglés"), Some("en"));
        assert_eq!(language_code("ja"), Some("ja"));
        assert_eq!(language_code("klingon"), None);
        assert!(is_language_token("<|es|>") && is_language_token("<|haw|>"));
        assert!(!is_language_token("<|endoftext|>") && !is_language_token("<|notimestamps|>"));
    }

    #[test]
    fn stops_a_repeating_loop_but_not_normal_text() {
        let looped: Vec<u32> = (0..8).chain(0..8).collect();
        assert!(repeating(&looped));
        assert!(!repeating(&(0..16).collect::<Vec<_>>()));
        assert!(!repeating(&[1, 1, 1]));
        assert_eq!(argmax(&[0.1, 3.0, -1.0]), 1);
    }

    #[test]
    fn only_multilingual_models_and_the_status_says_what_is_installed() {
        assert!(MODELS.iter().all(|m| !m.repo.ends_with(".en")));
        let tmp = std::env::temp_dir().join(format!("la-speech-{}", uuid::Uuid::new_v4()));
        let tiny = model("whisper-tiny").unwrap();
        assert!(!status(&tmp)[0].installed);
        std::fs::create_dir_all(dir(&tmp, tiny)).unwrap();
        for f in FILES {
            std::fs::write(dir(&tmp, tiny).join(f), "x").unwrap();
        }
        let s = status(&tmp);
        assert!(s[0].installed && !s[1].installed);
        remove(&tmp, tiny).unwrap();
        assert!(!installed(&tmp, tiny));
        assert!(model("whisper-large").is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// End to end with the real model (downloads ~150 MB the first time):
    /// `LA_SPEECH_WAV=ruta.wav cargo test --lib local_speech::tests::real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_transcription() {
        let data = PathBuf::from(std::env::var("LA_SPEECH_DIR").unwrap_or_else(|_| "D:/dev-cache/eureka-speech".into()));
        let tiny = model(&std::env::var("LA_SPEECH_MODEL").unwrap_or_else(|_| "whisper-tiny".into())).unwrap();
        if !installed(&data, tiny) {
            tokio::runtime::Runtime::new().unwrap().block_on(download(&data, tiny, |_, _| {})).unwrap();
        }
        let samples = wav_samples(&std::fs::read(std::env::var("LA_SPEECH_WAV").expect("LA_SPEECH_WAV")).unwrap()).unwrap();
        let started = std::time::Instant::now();
        let mut e = Engine::load(&data, tiny).unwrap();
        println!("cargado en {:?}", started.elapsed());
        let started = std::time::Instant::now();
        let text = e.transcribe(&samples, "español").unwrap();
        println!("«{text}» en {:?}", started.elapsed());
        assert!(!text.is_empty());
    }
}
