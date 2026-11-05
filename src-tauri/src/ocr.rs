//! Reading scanned pages and photos of printed text on this PC (AC-187, AC-188):
//! PaddleOCR's PP-OCRv6 small detector, the PP-OCR text-line orientation classifier
//! and the PP-OCRv5 Latin mobile recognizer, run with the same ONNX Runtime as the
//! local voice (Parakeet). The models ship inside the installer (build.rs downloads
//! them, pinned by sha256), so this works offline and costs no tokens.
//!
//! The pre- and post-processing mirror RapidOCR (Apache-2.0), which produced the
//! reference numbers: 0.3 % CER on a photocopied Spanish text. The UI renders each
//! page with pdf.js and hands over raw RGBA; everything else happens here.
#![cfg_attr(target_os = "android", allow(dead_code))]

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The models, as build.rs downloads them and the installer carries them.
pub const DET: &str = "PP-OCRv6_det_small.onnx";
pub const CLS: &str = "ch_ppocr_mobile_v2.0_cls_mobile.onnx";
pub const REC: &str = "latin_PP-OCRv5_rec_mobile.onnx";

/// Bigger pages are scaled down first (RapidOCR's `max_side_len`).
const MAX_SIDE: usize = 2000;
/// The detector sees the short side at least this big (`limit_side_len`, `limit_type: min`).
const DET_MIN_SIDE: usize = 736;
const DET_THRESH: f32 = 0.3;
const BOX_THRESH: f32 = 0.5;
const UNCLIP: f32 = 1.6;
const MAX_CANDIDATES: usize = 1000;
const REC_H: usize = 48;
const REC_W: usize = 320;
const CLS_H: usize = 48;
const CLS_W: usize = 192;
const BATCH: usize = 6;
/// Lines under this are dropped (RapidOCR's `text_score`).
const TEXT_SCORE: f32 = 0.5;
/// Lines under this are kept but flagged for review.
pub const REVIEW_SCORE: f32 = 0.8;

/// An RGB image, row-major.
pub struct Image {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Image {
    /// From the canvas' RGBA (alpha is dropped: the UI paints on white).
    pub fn from_rgba(w: usize, h: usize, rgba: &[u8]) -> Result<Self> {
        if w == 0 || h == 0 || rgba.len() != w * h * 4 {
            bail!("La imagen llegó incompleta ({w}×{h}, {} bytes).", rgba.len());
        }
        Ok(Self { w, h, px: rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect() })
    }

    #[inline]
    fn at(&self, x: usize, y: usize, c: usize) -> f32 {
        self.px[(y * self.w + x) * 3 + c] as f32
    }

    /// Bilinear sample with clamped borders (OpenCV's INTER_LINEAR + BORDER_REPLICATE).
    fn sample(&self, x: f32, y: f32, out: &mut [f32; 3]) {
        let (x, y) = (x.clamp(0.0, (self.w - 1) as f32), y.clamp(0.0, (self.h - 1) as f32));
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.w - 1), (y0 + 1).min(self.h - 1));
        let (ax, ay) = (x - x0 as f32, y - y0 as f32);
        for (c, o) in out.iter_mut().enumerate() {
            let top = self.at(x0, y0, c) * (1.0 - ax) + self.at(x1, y0, c) * ax;
            let bottom = self.at(x0, y1, c) * (1.0 - ax) + self.at(x1, y1, c) * ax;
            *o = top * (1.0 - ay) + bottom * ay;
        }
    }

    /// OpenCV-style resize (pixel centers aligned, no antialiasing).
    pub fn resize(&self, w: usize, h: usize) -> Image {
        let (sx, sy) = (self.w as f32 / w as f32, self.h as f32 / h as f32);
        let mut px = Vec::with_capacity(w * h * 3);
        let mut v = [0f32; 3];
        for y in 0..h {
            let fy = ((y as f32 + 0.5) * sy - 0.5).max(0.0);
            for x in 0..w {
                let fx = ((x as f32 + 0.5) * sx - 0.5).max(0.0);
                self.sample(fx, fy, &mut v);
                px.extend(v.iter().map(|c| c.round().clamp(0.0, 255.0) as u8));
            }
        }
        Image { w, h, px }
    }

    fn rotate180(&self) -> Image {
        let mut px = Vec::with_capacity(self.px.len());
        for p in self.px.chunks_exact(3).rev() {
            px.extend_from_slice(p);
        }
        Image { w: self.w, h: self.h, px }
    }

    /// Counter-clockwise, like `np.rot90`.
    fn rotate90(&self) -> Image {
        let (w, h) = (self.h, self.w);
        let mut px = Vec::with_capacity(self.px.len());
        for y in 0..h {
            for x in 0..w {
                let i = (x * self.w + (self.w - 1 - y)) * 3;
                px.extend_from_slice(&self.px[i..i + 3]);
            }
        }
        Image { w, h, px }
    }
}

/// Python's `round` (ties to even): RapidOCR's sizes depend on it.
fn round32(v: f64) -> usize {
    ((v / 32.0).round_ties_even() as usize * 32).max(32)
}

/// Pages bigger than MAX_SIDE are scaled down (to multiples of 32), like RapidOCR does
/// before anything else.
pub fn bounded(img: Image) -> Image {
    let (w, h) = bounded_size(img.w, img.h);
    if (w, h) == (img.w, img.h) { img } else { img.resize(w, h) }
}

fn bounded_size(w: usize, h: usize) -> (usize, usize) {
    if w.max(h) <= MAX_SIDE {
        return (w, h);
    }
    let r = MAX_SIDE as f64 / w.max(h) as f64;
    (round32((w as f64 * r).trunc()), round32((h as f64 * r).trunc()))
}

/// The detector's input size: the short side at least DET_MIN_SIDE, both multiples of 32.
pub fn det_size(w: usize, h: usize) -> (usize, usize) {
    let r = if w.min(h) < DET_MIN_SIDE { DET_MIN_SIDE as f64 / w.min(h) as f64 } else { 1.0 };
    (round32((w as f64 * r).trunc()), round32((h as f64 * r).trunc()))
}

/// CHW, BGR (PaddleOCR is trained on OpenCV's channel order), normalized to [-1, 1].
fn bgr_chw(img: &Image, out: &mut [f32], stride_w: usize) {
    let plane = img.h * stride_w;
    for y in 0..img.h {
        for x in 0..img.w {
            for c in 0..3 {
                out[(2 - c) * plane + y * stride_w + x] = img.at(x, y, c) / 127.5 - 1.0;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pt {
    pub x: f32,
    pub y: f32,
}

fn pt(x: f32, y: f32) -> Pt {
    Pt { x, y }
}

fn dist(a: Pt, b: Pt) -> f32 {
    (a.x - b.x).hypot(a.y - b.y)
}

fn cross(o: Pt, a: Pt, b: Pt) -> f32 {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/// Andrew's monotone chain; counter-clockwise, no repeated points.
fn hull(mut p: Vec<Pt>) -> Vec<Pt> {
    p.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    p.dedup();
    if p.len() < 3 {
        return p;
    }
    let mut h: Vec<Pt> = Vec::with_capacity(p.len() * 2);
    for pass in 0..2 {
        let start = h.len();
        let pts: Box<dyn Iterator<Item = &Pt>> = if pass == 0 { Box::new(p.iter()) } else { Box::new(p.iter().rev()) };
        for &q in pts {
            while h.len() >= start + 2 && cross(h[h.len() - 2], h[h.len() - 1], q) <= 0.0 {
                h.pop();
            }
            h.push(q);
        }
        h.pop();
    }
    h
}

/// The smallest rectangle around the points (rotating calipers over the hull edges),
/// as four corners in order plus its two side lengths (like `cv2.minAreaRect`).
pub fn min_area_rect(points: Vec<Pt>) -> ([Pt; 4], f32, f32) {
    let h = hull(points);
    if h.len() < 2 {
        let p = h.first().copied().unwrap_or(pt(0.0, 0.0));
        return ([p; 4], 0.0, 0.0);
    }
    let mut best = ([h[0]; 4], f32::MAX, 0.0, 0.0);
    for i in 0..h.len() {
        let (a, b) = (h[i], h[(i + 1) % h.len()]);
        let len = dist(a, b);
        if len == 0.0 {
            continue;
        }
        let u = pt((b.x - a.x) / len, (b.y - a.y) / len);
        let v = pt(-u.y, u.x);
        let (mut u0, mut u1, mut v0, mut v1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for q in &h {
            let (pu, pv) = (q.x * u.x + q.y * u.y, q.x * v.x + q.y * v.y);
            (u0, u1, v0, v1) = (u0.min(pu), u1.max(pu), v0.min(pv), v1.max(pv));
        }
        let area = (u1 - u0) * (v1 - v0);
        if area < best.1 {
            let at = |s: f32, t: f32| pt(s * u.x + t * v.x, s * u.y + t * v.y);
            best = ([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], area, u1 - u0, v1 - v0);
        }
    }
    (best.0, best.2, best.3)
}

/// Grows a rectangle by `d` on every side (keeps the corner order).
fn grow(r: &[Pt; 4], d: f32) -> [Pt; 4] {
    let c = pt(r.iter().map(|p| p.x).sum::<f32>() / 4.0, r.iter().map(|p| p.y).sum::<f32>() / 4.0);
    let (wu, hv) = (dist(r[0], r[1]), dist(r[1], r[2]));
    let u = if wu > 0.0 { pt((r[1].x - r[0].x) / wu, (r[1].y - r[0].y) / wu) } else { pt(1.0, 0.0) };
    let v = if hv > 0.0 { pt((r[2].x - r[1].x) / hv, (r[2].y - r[1].y) / hv) } else { pt(-u.y, u.x) };
    let (a, b) = (wu / 2.0 + d, hv / 2.0 + d);
    [(-a, -b), (a, -b), (a, b), (-a, b)].map(|(s, t)| pt(c.x + s * u.x + t * v.x, c.y + s * u.y + t * v.y))
}

/// Mean probability inside a convex polygon (OpenCV's `box_score_fast`).
fn box_score(prob: &[f32], w: usize, h: usize, poly: &[Pt; 4]) -> f32 {
    let x0 = poly.iter().map(|p| p.x).fold(f32::MAX, f32::min).floor().clamp(0.0, (w - 1) as f32) as usize;
    let x1 = poly.iter().map(|p| p.x).fold(f32::MIN, f32::max).ceil().clamp(0.0, (w - 1) as f32) as usize;
    let y0 = poly.iter().map(|p| p.y).fold(f32::MAX, f32::min).floor().clamp(0.0, (h - 1) as f32) as usize;
    let y1 = poly.iter().map(|p| p.y).fold(f32::MIN, f32::max).ceil().clamp(0.0, (h - 1) as f32) as usize;
    // Winding of the polygon, so "inside" is the same side of every edge.
    let sign = if cross(poly[0], poly[1], poly[2]) >= 0.0 { 1.0 } else { -1.0 };
    let (mut sum, mut n) = (0.0f64, 0usize);
    for y in y0..=y1 {
        for x in x0..=x1 {
            let q = pt(x as f32, y as f32);
            let inside = (0..4).all(|i| {
                let (a, b) = (poly[i], poly[(i + 1) % 4]);
                let len = dist(a, b).max(1e-6);
                sign * cross(a, b, q) / len >= -0.5
            });
            if inside {
                sum += prob[y * w + x] as f64;
                n += 1;
            }
        }
    }
    if n == 0 { 0.0 } else { (sum / n as f64) as f32 }
}

/// tl, tr, br, bl (RapidOCR's `order_points_clockwise`).
fn order_clockwise(p: [Pt; 4]) -> [Pt; 4] {
    let mut s = p;
    s.sort_by(|a, b| a.x.total_cmp(&b.x));
    let (mut l, mut r) = ([s[0], s[1]], [s[2], s[3]]);
    l.sort_by(|a, b| a.y.total_cmp(&b.y));
    r.sort_by(|a, b| a.y.total_cmp(&b.y));
    [l[0], r[0], r[1], l[1]]
}

/// DB post-processing: the detector's probability map (`w`×`h`) to text boxes in an
/// image of `dest_w`×`dest_h`. Threshold, 2×2 dilation, connected regions, the
/// smallest rotated rectangle of each, its mean score, and the "unclip" that grows it
/// back to the whole line.
pub fn db_boxes(prob: &[f32], w: usize, h: usize, dest_w: usize, dest_h: usize) -> Vec<([Pt; 4], f32)> {
    // Dilation with a 2×2 kernel anchored at its center: a pixel is on when it or its
    // left, top or top-left neighbour is above the threshold.
    let on = |x: usize, y: usize| prob[y * w + x] > DET_THRESH;
    let mut mask = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            mask[y * w + x] = on(x, y) || (x > 0 && on(x - 1, y)) || (y > 0 && on(x, y - 1)) || (x > 0 && y > 0 && on(x - 1, y - 1));
        }
    }
    let mut seen = vec![false; w * h];
    let mut out = Vec::new();
    let mut candidates = 0;
    let mut stack = Vec::new();
    for start in 0..w * h {
        if !mask[start] || seen[start] {
            continue;
        }
        candidates += 1;
        if candidates > MAX_CANDIDATES {
            break;
        }
        // One 8-connected region; per row, its leftmost and rightmost pixel is all the hull needs.
        let mut rows: std::collections::BTreeMap<usize, (usize, usize)> = std::collections::BTreeMap::new();
        seen[start] = true;
        stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            let e = rows.entry(y).or_insert((x, x));
            (e.0, e.1) = (e.0.min(x), e.1.max(x));
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if mask[j] && !seen[j] {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        let points: Vec<Pt> = rows.iter().flat_map(|(&y, &(a, b))| [pt(a as f32, y as f32), pt(b as f32, y as f32)]).collect();
        let (rect, rw, rh) = min_area_rect(points);
        if rw.min(rh) < 3.0 {
            continue;
        }
        let score = box_score(prob, w, h, &rect);
        if score < BOX_THRESH {
            continue;
        }
        let d = rw * rh * UNCLIP / (2.0 * (rw + rh));
        if rw.min(rh) + 2.0 * d < 5.0 {
            continue;
        }
        let grown = grow(&rect, d);
        let scaled = grown.map(|p| {
            let x = (p.x / w as f32 * dest_w as f32).round().clamp(0.0, dest_w as f32);
            let y = (p.y / h as f32 * dest_h as f32).round().clamp(0.0, dest_h as f32);
            // RapidOCR clips to the last pixel after ordering the corners.
            pt(x.min((dest_w - 1) as f32), y.min((dest_h - 1) as f32))
        });
        let q = order_clockwise(scaled);
        if dist(q[0], q[1]).trunc() <= 3.0 || dist(q[0], q[3]).trunc() <= 3.0 {
            continue;
        }
        out.push((q, score));
    }
    out
}

/// The line under a box, straightened (perspective from the four corners), rotated
/// upright when it's much taller than wide (RapidOCR's `get_rotate_crop_image`).
pub fn crop(img: &Image, q: &[Pt; 4]) -> Image {
    let cw = dist(q[0], q[1]).max(dist(q[2], q[3])).trunc().max(1.0) as usize;
    let ch = dist(q[0], q[3]).max(dist(q[1], q[2])).trunc().max(1.0) as usize;
    // Unit square → quad (Heckbert): (0,0)→q0, (1,0)→q1, (1,1)→q2, (0,1)→q3.
    let (x0, x1, x2, x3) = (q[0].x, q[1].x, q[2].x, q[3].x);
    let (y0, y1, y2, y3) = (q[0].y, q[1].y, q[2].y, q[3].y);
    let (dx3, dy3) = (x0 - x1 + x2 - x3, y0 - y1 + y2 - y3);
    let (a, b, c, d, e, f, g, hh);
    if dx3.abs() < 1e-6 && dy3.abs() < 1e-6 {
        (a, b, c, d, e, f, g, hh) = (x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0.0, 0.0);
    } else {
        let (dx1, dx2, dy1, dy2) = (x1 - x2, x3 - x2, y1 - y2, y3 - y2);
        let den = dx1 * dy2 - dx2 * dy1;
        g = (dx3 * dy2 - dx2 * dy3) / den;
        hh = (dx1 * dy3 - dx3 * dy1) / den;
        (a, b, c, d, e, f) = (x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0);
    }
    let mut px = Vec::with_capacity(cw * ch * 3);
    let mut v = [0f32; 3];
    for y in 0..ch {
        let t = y as f32 / ch as f32;
        for x in 0..cw {
            let s = x as f32 / cw as f32;
            let z = g * s + hh * t + 1.0;
            img.sample((a * s + b * t + c) / z, (d * s + e * t + f) / z, &mut v);
            px.extend(v.iter().map(|c| c.round().clamp(0.0, 255.0) as u8));
        }
    }
    let out = Image { w: cw, h: ch, px };
    if ch as f32 / cw as f32 >= 1.5 { out.rotate90() } else { out }
}

/// One crop into a `[3, h, width]` slot: resized to height `h` keeping its ratio
/// (at most `width` wide), normalized, zero-padded on the right.
fn fill_slot(img: &Image, h: usize, width: usize, out: &mut [f32]) {
    let rw = ((h as f64 * img.w as f64 / img.h as f64).ceil() as usize).clamp(1, width);
    let r = img.resize(rw, h);
    bgr_chw(&r, out, width);
}

/// CTC greedy decoding: best class per step, repeats collapsed, blanks (0) dropped.
/// The model already ends in a softmax, so the best value is the probability.
pub fn ctc_decode(probs: &[f32], steps: usize, classes: usize, chars: &[String]) -> (String, f32) {
    let (mut text, mut conf, mut prev) = (String::new(), Vec::new(), usize::MAX);
    for t in 0..steps {
        let row = &probs[t * classes..(t + 1) * classes];
        let (best, p) = row.iter().enumerate().fold((0, f32::MIN), |acc, (i, &p)| if p > acc.1 { (i, p) } else { acc });
        if best != prev && best != 0 {
            if let Some(c) = chars.get(best) {
                text.push_str(c);
                conf.push(p);
            }
        }
        prev = best;
    }
    let mean = if conf.is_empty() { 0.0 } else { conf.iter().sum::<f32>() / conf.len() as f32 };
    (text, mean)
}

/// The recognizer's alphabet: index 0 is the CTC blank, then the model's own
/// dictionary (ONNX metadata `character`, one per line), then the space.
pub fn alphabet(dict: &str) -> Vec<String> {
    std::iter::once("blank".to_string()).chain(dict.lines().map(str::to_string)).chain(std::iter::once(" ".to_string())).collect()
}

/// One recognized line, in the page's own pixels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Line {
    pub text: String,
    pub confidence: f32,
    /// x0, y0, x1, y1.
    pub bbox: [f32; 4],
}

/// What the UI gets for a page or a photo.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PageText {
    /// Paragraphs (blank line between them), in reading order.
    pub markdown: String,
    pub lines: Vec<Line>,
    /// Mean line confidence weighted by length (0 when nothing was read).
    pub confidence: f32,
    /// Letters and digits read: "enough text" for a photo.
    pub chars: usize,
    /// Lines below REVIEW_SCORE: shown as «revisar» next to the page.
    pub review: Vec<String>,
}

fn alnum(s: &str) -> usize {
    s.chars().filter(|c| c.is_alphanumeric()).count()
}

/// A speck: nothing legible, or one or two characters read with little confidence.
pub fn is_speck(line: &Line) -> bool {
    let n = alnum(&line.text);
    n == 0 || (n <= 2 && line.confidence < REVIEW_SCORE)
}

/// A whole row that is noise: one or two characters alone, or a bare page number at
/// the top or bottom of the page.
pub fn is_noise_row(text: &str, edge: bool) -> bool {
    let t = text.trim();
    (alnum(t) <= 2 && t.chars().count() <= 3) || (edge && t.len() <= 4 && t.chars().all(|c| c.is_ascii_digit()))
}

fn median(mut v: Vec<f32>) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(f32::total_cmp);
    v[v.len() / 2]
}

/// Reading order: top to bottom, with simple columns. When a vertical gutter splits
/// the text (no line crosses it, and both sides have lines), each band between
/// full-width lines is read left column first.
pub fn reading_order(lines: &[Line]) -> Vec<Vec<Line>> {
    if lines.is_empty() {
        return vec![];
    }
    let lh = median(lines.iter().map(|l| l.bbox[3] - l.bbox[1]).collect()).max(1.0);
    let (left, right) = (lines.iter().map(|l| l.bbox[0]).fold(f32::MAX, f32::min), lines.iter().map(|l| l.bbox[2]).fold(f32::MIN, f32::max));
    let span = right - left;
    // The gutter: the x in the middle of the text crossed by the fewest lines.
    let mut gutter = None;
    if lines.len() >= 6 && span > 0.0 {
        let mut best = (usize::MAX, 0.0);
        for k in 30..=70 {
            let x = left + span * k as f32 / 100.0;
            let crossing = lines.iter().filter(|l| l.bbox[0] < x && l.bbox[2] > x).count();
            if crossing < best.0 {
                best = (crossing, x);
            }
        }
        let x = best.1;
        let (l, r) = (lines.iter().filter(|l| l.bbox[2] <= x).count(), lines.iter().filter(|l| l.bbox[0] >= x).count());
        if best.0 <= (lines.len() / 10).max(1) && l >= 3 && r >= 3 {
            gutter = Some(x);
        }
    }
    let mut sorted: Vec<Line> = lines.to_vec();
    sorted.sort_by(|a, b| a.bbox[1].total_cmp(&b.bbox[1]));
    let Some(x) = gutter else { return rows(sorted, lh) };
    let mut out = Vec::new();
    let (mut l, mut r) = (Vec::new(), Vec::new());
    let flush = |l: &mut Vec<Line>, r: &mut Vec<Line>, out: &mut Vec<Vec<Line>>| {
        out.extend(rows(std::mem::take(l), lh));
        out.extend(rows(std::mem::take(r), lh));
    };
    for line in sorted {
        if line.bbox[0] < x && line.bbox[2] > x {
            flush(&mut l, &mut r, &mut out);
            out.push(vec![line]);
        } else if line.bbox[2] <= x {
            l.push(line);
        } else {
            r.push(line);
        }
    }
    flush(&mut l, &mut r, &mut out);
    out
}

/// Boxes on the same baseline (the detector sometimes splits a line) → one row, left to right.
fn rows(sorted: Vec<Line>, lh: f32) -> Vec<Vec<Line>> {
    let mut out: Vec<Vec<Line>> = Vec::new();
    for line in sorted {
        let cy = (line.bbox[1] + line.bbox[3]) / 2.0;
        match out.last_mut() {
            Some(row) if (cy - (row[0].bbox[1] + row[0].bbox[3]) / 2.0).abs() < lh * 0.5 => row.push(line),
            _ => out.push(vec![line]),
        }
    }
    for row in &mut out {
        row.sort_by(|a, b| a.bbox[0].total_cmp(&b.bbox[0]));
    }
    out
}

/// Lines to the page's text: reading order, noise dropped, paragraphs where the gap
/// between rows is big or a row starts indented after a sentence ends, hyphenated
/// words rejoined.
pub fn page_text(mut lines: Vec<Line>) -> PageText {
    lines.retain(|l| !is_speck(l));
    let ordered = reading_order(&lines);
    let n = ordered.len();
    let kept: Vec<Vec<Line>> = ordered
        .into_iter()
        .enumerate()
        .filter(|(i, row)| !is_noise_row(&row.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" "), *i == 0 || *i + 1 == n))
        .map(|(_, row)| row)
        .collect();
    let lh = median(kept.iter().flatten().map(|l| l.bbox[3] - l.bbox[1]).collect()).max(1.0);
    let mut paras: Vec<String> = Vec::new();
    let mut para = String::new();
    let mut prev: Option<[f32; 4]> = None;
    for row in &kept {
        let text = row.iter().map(|l| l.text.trim()).collect::<Vec<_>>().join(" ");
        let b = [row[0].bbox[0], row.iter().map(|l| l.bbox[1]).fold(f32::MAX, f32::min), row.last().unwrap().bbox[2], row.iter().map(|l| l.bbox[3]).fold(f32::MIN, f32::max)];
        if let Some(p) = prev {
            let gap = b[1] - p[3];
            let ends = para.ends_with(['.', ':', '?', '!']);
            let indented = b[0] - p[0] > lh * 1.2;
            // A row above the previous one starts another column or band.
            if gap > lh * 1.0 || b[3] < p[1] || (ends && indented) {
                paras.push(std::mem::take(&mut para));
            }
        }
        if para.ends_with('-') && text.starts_with(|c: char| c.is_lowercase()) {
            para.pop();
            para.push_str(&text);
        } else {
            if !para.is_empty() {
                para.push(' ');
            }
            para.push_str(&text);
        }
        prev = Some(b);
    }
    if !para.is_empty() {
        paras.push(para);
    }
    let read: Vec<Line> = kept.into_iter().flatten().collect();
    let (chars, weighted) = read.iter().fold((0usize, 0f32), |(n, s), l| {
        let k = alnum(&l.text).max(1);
        (n + k, s + l.confidence * k as f32)
    });
    PageText {
        markdown: paras.join("\n\n"),
        confidence: if chars == 0 { 0.0 } else { weighted / chars as f32 },
        chars: read.iter().map(|l| alnum(&l.text)).sum(),
        review: read.iter().filter(|l| l.confidence < REVIEW_SCORE).map(|l| l.text.clone()).collect(),
        lines: read,
    }
}

/// Where the models are: the installer's resources, or (in a debug build) the folder
/// build.rs downloads them to.
pub fn models_dir(resources: Option<PathBuf>) -> Option<PathBuf> {
    let has = |d: &Path| [DET, CLS, REC].iter().all(|f| d.join(f).is_file());
    if let Some(d) = resources.map(|r| r.join("ocr")).filter(|d| has(d)) {
        return Some(d);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ocr-models");
    (cfg!(debug_assertions) && has(&dev)).then_some(dev)
}

#[cfg(not(target_os = "android"))]
use parakeet_rs::ort::{self, session::Session, value::Tensor};

/// The three sessions, created once and kept for every page.
#[cfg(not(target_os = "android"))]
pub struct Engine {
    det: Session,
    cls: Session,
    rec: Session,
    chars: Vec<String>,
}

#[cfg(not(target_os = "android"))]
impl Engine {
    pub fn load(dir: &Path) -> Result<Self> {
        let env = ort::init().with_name("eureka-ocr").build().map_err(|e| anyhow!("no se pudo iniciar ONNX Runtime: {e}"))?;
        let open = |f: &str| -> Result<Session> {
            Session::builder(&env).and_then(|mut b| b.commit_from_file(dir.join(f))).map_err(|e| anyhow!("no se pudo cargar el modelo de OCR {f}: {e}"))
        };
        let (det, cls, rec) = (open(DET)?, open(CLS)?, open(REC)?);
        let dict = rec.metadata().ok().and_then(|m| m.custom("character")).ok_or_else(|| anyhow!("el modelo de OCR no trae su diccionario"))?;
        Ok(Self { det, cls, rec, chars: alphabet(&dict) })
    }

    /// Every line of the image, with its confidence and box in the image's pixels.
    pub fn read(&mut self, img: Image) -> Result<Vec<Line>> {
        let (ow, oh) = (img.w as f32, img.h as f32);
        let img = bounded(img);
        let (kx, ky) = (ow / img.w as f32, oh / img.h as f32);
        let (dw, dh) = det_size(img.w, img.h);
        let det_in = if (dw, dh) == (img.w, img.h) { None } else { Some(img.resize(dw, dh)) };
        let mut input = vec![0f32; 3 * dw * dh];
        bgr_chw(det_in.as_ref().unwrap_or(&img), &mut input, dw);
        let boxes = {
            let out = self.det.run(ort::inputs![Tensor::from_array(([1usize, 3, dh, dw], input))?])?;
            let (shape, prob) = out[0].try_extract_tensor::<f32>()?;
            let (ph, pw) = (shape[2] as usize, shape[3] as usize);
            db_boxes(prob, pw, ph, img.w, img.h)
        };
        let mut crops: Vec<Image> = boxes.iter().map(|(q, _)| crop(&img, q)).collect();
        // Widest last, so each batch pads little (RapidOCR sorts the same way).
        let mut order: Vec<usize> = (0..crops.len()).collect();
        order.sort_by(|&a, &b| (crops[a].w as f32 / crops[a].h as f32).total_cmp(&(crops[b].w as f32 / crops[b].h as f32)));
        for batch in order.chunks(BATCH) {
            let mut input = vec![0f32; batch.len() * 3 * CLS_H * CLS_W];
            for (k, &i) in batch.iter().enumerate() {
                fill_slot(&crops[i], CLS_H, CLS_W, &mut input[k * 3 * CLS_H * CLS_W..(k + 1) * 3 * CLS_H * CLS_W]);
            }
            let out = self.cls.run(ort::inputs![Tensor::from_array(([batch.len(), 3, CLS_H, CLS_W], input))?])?;
            let (_, p) = out[0].try_extract_tensor::<f32>()?;
            for (k, &i) in batch.iter().enumerate() {
                if p[k * 2 + 1] > p[k * 2] && p[k * 2 + 1] > 0.9 {
                    crops[i] = crops[i].rotate180();
                }
            }
        }
        let mut lines: Vec<Option<Line>> = vec![None; crops.len()];
        for batch in order.chunks(BATCH) {
            let ratio = batch.iter().map(|&i| crops[i].w as f32 / crops[i].h as f32).fold(REC_W as f32 / REC_H as f32, f32::max);
            let width = (REC_H as f32 * ratio) as usize;
            let slot = 3 * REC_H * width;
            let mut input = vec![0f32; batch.len() * slot];
            for (k, &i) in batch.iter().enumerate() {
                fill_slot(&crops[i], REC_H, width, &mut input[k * slot..(k + 1) * slot]);
            }
            let out = self.rec.run(ort::inputs![Tensor::from_array(([batch.len(), 3, REC_H, width], input))?])?;
            let (shape, p) = out[0].try_extract_tensor::<f32>()?;
            let (steps, classes) = (shape[1] as usize, shape[2] as usize);
            if classes != self.chars.len() {
                bail!("el diccionario del OCR no coincide con el modelo ({classes} clases, {} caracteres)", self.chars.len());
            }
            for (k, &i) in batch.iter().enumerate() {
                let (text, confidence) = ctc_decode(&p[k * steps * classes..(k + 1) * steps * classes], steps, classes, &self.chars);
                let q = &boxes[i].0;
                let bbox = [
                    q.iter().map(|p| p.x).fold(f32::MAX, f32::min) * kx,
                    q.iter().map(|p| p.y).fold(f32::MAX, f32::min) * ky,
                    q.iter().map(|p| p.x).fold(f32::MIN, f32::max) * kx,
                    q.iter().map(|p| p.y).fold(f32::MIN, f32::max) * ky,
                ];
                lines[i] = Some(Line { text, confidence, bbox });
            }
        }
        Ok(lines.into_iter().flatten().filter(|l| l.confidence >= TEXT_SCORE && !l.text.trim().is_empty()).collect())
    }
}

#[cfg(target_os = "android")]
pub struct Engine;

#[cfg(target_os = "android")]
impl Engine {
    pub fn load(_dir: &Path) -> Result<Self> {
        bail!("En el celular todavía no leo PDFs escaneados.")
    }

    pub fn read(&mut self, _img: Image) -> Result<Vec<Line>> {
        bail!("En el celular todavía no leo PDFs escaneados.")
    }
}

/// Per-page results kept by file hash, so a long reading resumes where it stopped
/// (the app closed, or the person canceled): `ocr/<sha256>.json`.
pub struct Cache {
    dir: PathBuf,
}

impl Cache {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("ocr") }
    }

    fn path(&self, hash: &str) -> Result<PathBuf> {
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            bail!("huella de archivo inválida");
        }
        Ok(self.dir.join(format!("{}.json", hash.to_ascii_lowercase())))
    }

    pub fn get(&self, hash: &str) -> Result<std::collections::BTreeMap<u32, PageText>> {
        Ok(std::fs::read_to_string(self.path(hash)?).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default())
    }

    pub fn put(&self, hash: &str, page: u32, text: PageText) -> Result<()> {
        let mut all = self.get(hash)?;
        all.insert(page, text);
        std::fs::create_dir_all(&self.dir)?;
        let path = self.path(hash)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(&all)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    pub fn clear(&self, hash: &str) -> Result<()> {
        let _ = std::fs::remove_file(self.path(hash)?);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, confidence: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> Line {
        Line { text: text.into(), confidence, bbox: [x0, y0, x1, y1] }
    }

    #[test]
    fn db_postprocess_finds_a_line_and_grows_it_back() {
        // A 100×40 map with one "text line" of high probability (x 10..=89, y 15..=24).
        let (w, h) = (100, 40);
        let mut prob = vec![0.0f32; w * h];
        for y in 15..=24 {
            for x in 10..=89 {
                prob[y * w + x] = 0.9;
            }
        }
        // A speck too small to be text, and a faint region below the box threshold.
        prob[2 * w + 2] = 0.9;
        for y in 30..=36 {
            for x in 10..=40 {
                prob[y * w + x] = 0.35;
            }
        }
        let boxes = db_boxes(&prob, w, h, 200, 80);
        assert_eq!(boxes.len(), 1, "{boxes:?}");
        let (q, score) = boxes[0];
        // Like Python's fillPoly, the dilated border (probability 0) counts: 0.9·80·10/(81·11).
        assert!((score - 0.808).abs() < 0.01, "{score}");
        // The region after the 2×2 dilation is 81×11 px (centers 10..=90, 15..=25) → rect 80×10;
        // unclip d = 80·10·1.6/180 ≈ 7.1 on every side, then everything doubles (200×80).
        let (x0, x1) = (q[0].x, q[1].x);
        let (y0, y3) = (q[0].y, q[3].y);
        assert!((x0 - 2.0 * (10.0 - 7.1)).abs() <= 1.5, "{q:?}");
        assert!((x1 - 2.0 * (90.0 + 7.1)).abs() <= 1.5, "{q:?}");
        assert!((y0 - 2.0 * (15.0 - 7.1)).abs() <= 1.5 && (y3 - 2.0 * (25.0 + 7.1)).abs() <= 1.5, "{q:?}");
    }

    #[test]
    fn min_area_rect_follows_a_tilted_line() {
        // A thin band tilted ~5°: the rectangle follows it instead of boxing it upright.
        let pts: Vec<Pt> = (0..200).flat_map(|x| (0..8).map(move |y| pt(x as f32, y as f32 + x as f32 * 0.0875))).collect();
        let (r, a, b) = min_area_rect(pts);
        let (long, short) = (a.max(b), a.min(b));
        assert!((long - 199.8).abs() < 1.5 && short < 8.5, "{long} × {short}");
        let q = order_clockwise(r);
        assert!(q[1].y > q[0].y, "the top edge goes down to the right: {q:?}");
    }

    #[test]
    fn crop_straightens_and_rotates_tall_boxes() {
        let mut img = Image { w: 4, h: 4, px: vec![0; 48] };
        // Bright left column.
        for y in 0..4 {
            img.px[y * 12..y * 12 + 3].copy_from_slice(&[200, 200, 200]);
        }
        let q = [pt(0.0, 0.0), pt(1.0, 0.0), pt(1.0, 3.0), pt(0.0, 3.0)];
        let c = crop(&img, &q);
        // 1×3 is tall: rotated to 3×1.
        assert_eq!((c.w, c.h), (3, 1));
        assert!(c.px.iter().all(|&v| v == 200), "{:?}", c.px);
        let r = Image { w: 2, h: 1, px: vec![1, 2, 3, 4, 5, 6] }.rotate180();
        assert_eq!(r.px, vec![4, 5, 6, 1, 2, 3]);
        assert_eq!(det_size(1217, 515), (1728, 736));
        assert_eq!(det_size(1216, 1664), (1216, 1664));
        assert_eq!(bounded_size(1800, 2458), (1472, 1984), "Python rounds 62.5 to even");
        assert_eq!(bounded_size(1217, 1662), (1217, 1662));
    }

    #[test]
    fn ctc_collapses_repeats_and_drops_blanks() {
        let chars = alphabet("a\nb\nc\n");
        assert_eq!(chars.len(), 5);
        assert_eq!((chars[0].as_str(), chars[4].as_str()), ("blank", " "));
        // a a · a b ␠ b b: repeats collapse only when adjacent; a blank separates the two a.
        let steps = [1, 1, 0, 1, 2, 4, 2, 2];
        let classes = chars.len();
        let mut probs = vec![0.0f32; steps.len() * classes];
        for (t, &c) in steps.iter().enumerate() {
            probs[t * classes + c] = if t == 0 { 0.6 } else { 0.9 };
        }
        let (text, conf) = ctc_decode(&probs, steps.len(), classes, &chars);
        assert_eq!(text, "aab b");
        // a (0.6), a, b, space, b → (0.6 + 0.9·4) / 5
        assert!((conf - 0.84).abs() < 1e-5, "{conf}");
        assert_eq!(ctc_decode(&vec![0.0; classes], 1, classes, &chars), (String::new(), 0.0));
    }

    #[test]
    fn reads_two_columns_left_first_with_a_full_width_title() {
        let mut lines = vec![line("Título que cruza la página", 0.99, 50.0, 10.0, 950.0, 40.0)];
        for i in 0..4 {
            let y = 60.0 + i as f32 * 30.0;
            lines.push(line(&format!("derecha {i}"), 0.99, 520.0, y, 950.0, y + 20.0));
            lines.push(line(&format!("izquierda {i}"), 0.99, 50.0, y, 480.0, y + 20.0));
        }
        let rows: Vec<String> = reading_order(&lines).iter().map(|r| r.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ")).collect();
        assert_eq!(rows[0], "Título que cruza la página");
        assert_eq!(&rows[1..5], ["izquierda 0", "izquierda 1", "izquierda 2", "izquierda 3"]);
        assert_eq!(rows[5], "derecha 0");
        // One column: boxes split on the same baseline join left to right.
        let one = vec![line("mundo", 0.99, 300.0, 12.0, 400.0, 30.0), line("Hola", 0.99, 50.0, 10.0, 280.0, 31.0), line("abajo", 0.99, 50.0, 40.0, 200.0, 60.0)];
        let rows: Vec<Vec<String>> = reading_order(&one).iter().map(|r| r.iter().map(|l| l.text.clone()).collect()).collect();
        assert_eq!(rows, [vec!["Hola", "mundo"], vec!["abajo"]]);
    }

    #[test]
    fn page_text_drops_noise_joins_hyphens_and_weighs_confidence() {
        let lines = vec![
            line("12", 0.99, 480.0, 5.0, 500.0, 25.0),
            line("La planifica-", 0.98, 50.0, 40.0, 900.0, 60.0),
            line("ción es pensar para actuar.", 0.96, 50.0, 64.0, 600.0, 84.0),
            line("·", 0.6, 700.0, 66.0, 705.0, 80.0),
            line("Otro párrafo, con sangría.", 0.7, 90.0, 88.0, 900.0, 108.0),
        ];
        let p = page_text(lines);
        assert_eq!(p.markdown, "La planificación es pensar para actuar.\n\nOtro párrafo, con sangría.");
        assert_eq!(p.lines.len(), 3, "the page number and the speck are gone");
        assert_eq!(p.review, ["Otro párrafo, con sangría."]);
        let n = ["La planifica-", "ción es pensar para actuar.", "Otro párrafo, con sangría."].map(|t| alnum(t) as f32);
        let expected = (0.98 * n[0] + 0.96 * n[1] + 0.7 * n[2]) / n.iter().sum::<f32>();
        assert_eq!(p.chars, n.iter().sum::<f32>() as usize);
        assert!((p.confidence - expected).abs() < 1e-4, "{} vs {expected}", p.confidence);
        // "a)" next to its text is kept (the row has text); alone it's noise.
        assert!(!is_speck(&line("a)", 0.95, 0.0, 0.0, 1.0, 1.0)) && is_speck(&line("a)", 0.5, 0.0, 0.0, 1.0, 1.0)));
        assert!(is_noise_row("Sí", false) && !is_noise_row("a) Sí", false));
        assert!(!is_noise_row("1810", false) && is_noise_row("1810", true), "a number is a page number only at the edge");
        assert!(page_text(vec![]).markdown.is_empty());
    }

    #[test]
    fn cache_keeps_pages_by_hash() {
        let dir = std::env::temp_dir().join(format!("la-ocr-{}", uuid::Uuid::new_v4().simple()));
        let c = Cache::new(&dir);
        let h = "ab".repeat(32);
        assert!(c.get(&h).unwrap().is_empty());
        c.put(&h, 3, PageText { markdown: "tres".into(), ..Default::default() }).unwrap();
        c.put(&h, 1, PageText { markdown: "uno".into(), ..Default::default() }).unwrap();
        let got = c.get(&h).unwrap();
        assert_eq!(got.keys().copied().collect::<Vec<_>>(), [1, 3]);
        assert!(c.get("../x").is_err());
        c.clear(&h).unwrap();
        assert!(c.get(&h).unwrap().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    fn png(path: &str) -> Image {
        let dec = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).unwrap()));
        let mut r = dec.read_info().unwrap();
        let mut buf = vec![0; r.output_buffer_size().unwrap()];
        let info = r.next_frame(&mut buf).unwrap();
        let (w, h) = (info.width as usize, info.height as usize);
        let ch = info.color_type.samples();
        let px = buf[..w * h * ch].chunks_exact(ch).flat_map(|p| if ch >= 3 { [p[0], p[1], p[2]] } else { [p[0]; 3] }).collect();
        Image { w, h, px }
    }

    fn lev<T: PartialEq>(a: &[T], b: &[T]) -> usize {
        let mut prev: Vec<usize> = (0..=b.len()).collect();
        for i in 1..=a.len() {
            let mut cur = vec![i; b.len() + 1];
            for j in 1..=b.len() {
                cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1]));
            }
            prev = cur;
        }
        prev[b.len()]
    }

    fn norm(s: &str) -> String {
        s.replace(['“', '”', '«', '»'], "\"").split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// A real page against a hand-made transcription. Nothing of it lives in the repo:
    /// OCR_PNG is the page, OCR_TRUTH a text file with the passage, OCR_CROP the
    /// passage's vertical band ("0.425,0.31": from 42.5 % of the height, 31 % tall).
    /// Optional OCR_PAGES: more PNGs (comma-separated) to time whole pages.
    /// `cargo test --release --lib ocr::tests::real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_scanned_page_cer_and_speed() {
        let dir = std::env::var("OCR_MODELS").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ocr-models"));
        let truth = norm(&std::fs::read_to_string(std::env::var("OCR_TRUTH").expect("OCR_TRUTH")).unwrap());
        let page = png(&std::env::var("OCR_PNG").expect("OCR_PNG"));
        let band: Vec<f64> = std::env::var("OCR_CROP").unwrap_or("0.425,0.31".into()).split(',').map(|v| v.trim().parse().unwrap()).collect();
        let (y0, hh) = ((page.h as f64 * band[0]) as usize, (page.h as f64 * band[1]) as usize);
        let crop = Image { w: page.w, h: hh, px: page.px[y0 * page.w * 3..(y0 + hh) * page.w * 3].to_vec() };
        let t = std::time::Instant::now();
        let mut e = Engine::load(&dir).unwrap();
        eprintln!("sesiones creadas en {:?}", t.elapsed());
        let lines = e.read(Image { w: crop.w, h: crop.h, px: crop.px.clone() }).unwrap();
        let t = std::time::Instant::now();
        let lines2 = e.read(crop).unwrap();
        eprintln!("recorte: {} líneas en {:?}", lines2.len(), t.elapsed());
        assert_eq!(lines, lines2, "same input, same output");
        let got = norm(&page_text(lines).markdown.replace("\n\n", " "));
        let cer = 100.0 * lev(&truth.chars().collect::<Vec<_>>(), &got.chars().collect::<Vec<_>>()) as f64 / truth.chars().count() as f64;
        let (tw, gw): (Vec<&str>, Vec<&str>) = (truth.split(' ').collect(), got.split(' ').collect());
        let wer = 100.0 * lev(&tw, &gw) as f64 / tw.len() as f64;
        eprintln!("CER {cer:.2} % · WER {wer:.2} %\n{got}");
        let mut pages: Vec<String> = std::env::var("OCR_PAGES").map(|v| v.split(',').map(str::to_string).collect()).unwrap_or_default();
        pages.retain(|p| !p.trim().is_empty());
        if !pages.is_empty() {
            let imgs: Vec<Image> = pages.iter().map(|p| png(p.trim())).collect();
            let mut conf = Vec::new();
            let t = std::time::Instant::now();
            for img in imgs {
                let p = page_text(e.read(img).unwrap());
                conf.push(p.confidence);
            }
            eprintln!("{} páginas: {:.2} s/página, confianza {conf:?}", pages.len(), t.elapsed().as_secs_f64() / pages.len() as f64);
            if let Ok(w) = std::env::var("OCR_RENDER_WIDTH") {
                // The size the UI renders at (pdf.js, ~1800 px wide): the page scaled up.
                let w: usize = w.parse().unwrap();
                let imgs: Vec<Image> = pages.iter().map(|p| {
                    let i = png(p.trim());
                    let h = i.h * w / i.w;
                    i.resize(w, h)
                }).collect();
                let t = std::time::Instant::now();
                for img in imgs {
                    e.read(img).unwrap();
                }
                eprintln!("a {w} px de ancho: {:.2} s/página", t.elapsed().as_secs_f64() / pages.len() as f64);
            }
        }
        assert!(cer <= 1.0, "CER {cer:.2} %");
    }
}
