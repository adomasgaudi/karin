//! Karin's mark — the red glasses — rasterised at whatever size is asked for.
//!
//! One source of truth for three consumers: the window icon, the taskbar icon,
//! and the `.ico` the desktop shortcut points at. Drawing it in code rather than
//! shipping a PNG means no image decoder in the binary and no chance of the
//! shortcut and the window disagreeing.
//!
//! Geometry is kept in the original SVG's coordinate space (a 40×18 viewBox,
//! `src/components/KarinLogo.tsx`) so the two marks stay comparable by eye.

use std::io::{self, Write};
use std::path::Path;

const RED: [u8; 3] = [220, 38, 38];
const TILE: [u8; 3] = [246, 245, 244];
const EDGE: [u8; 3] = [214, 211, 209];

/// Where the 40-wide glasses sit inside the square, as a fraction of it. Tight,
/// because a 16px tile only has room for the mark itself.
const INSET: f32 = 0.06;
const UNIT: f32 = (1.0 - 2.0 * INSET) / 40.0;

/// Samples per axis. Nine per pixel is enough to keep a 1.6-unit stroke smooth
/// at 16px, where the whole mark is barely eleven pixels wide.
const SS: u32 = 3;

/// RGBA8, row-major, `size * size * 4` bytes.
pub fn rgba(size: u32) -> Vec<u8> {
    let mut out = vec![0u8; (size * size * 4) as usize];
    let n = size as f32;
    let radius = n * 0.22;

    // Below about 32px the 1.6-unit stroke lands on less than a pixel and the
    // mark turns to mush, so the line is widened to hold at least one, and the
    // frame arms — three units long — are dropped rather than drawn as specks.
    let per_pixel = 1.0 / (n * UNIT);
    let stroke = 0.8f32.max(0.6 * per_pixel);
    let arms = size >= 32;

    for py in 0..size {
        for px in 0..size {
            let (mut tile, mut edge, mut ink) = (0.0f32, 0.0f32, 0.0f32);
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = px as f32 + (sx as f32 + 0.5) / SS as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SS as f32;
                    let d = rounded_square(x, y, n, radius);
                    if d > 0.0 {
                        continue;
                    }
                    tile += 1.0;
                    if d > -n * 0.018 {
                        edge += 1.0;
                    }
                    // Into the SVG's own coordinates, where the shapes live.
                    let gx = (x / n - INSET) / UNIT;
                    let gy = 9.0 + (y / n - 0.5) / UNIT;
                    if glasses(gx, gy, stroke, arms) {
                        ink += 1.0;
                    }
                }
            }
            let total = (SS * SS) as f32;
            let i = ((py * size + px) * 4) as usize;
            let (tile, edge, ink) = (tile / total, edge / total, ink / total);
            let base = mix(TILE, EDGE, edge);
            let rgb = mix(base, RED, ink);
            out[i] = rgb[0];
            out[i + 1] = rgb[1];
            out[i + 2] = rgb[2];
            out[i + 3] = (tile * 255.0).round() as u8;
        }
    }
    out
}

fn mix(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    let t = t.clamp(0.0, 1.0);
    let f = |i: usize| (a[i] as f32 * (1.0 - t) + b[i] as f32 * t).round() as u8;
    [f(0), f(1), f(2)]
}

/// Signed distance to the tile: negative inside.
fn rounded_square(x: f32, y: f32, n: f32, r: f32) -> f32 {
    let (dx, dy) = (
        (x - n * 0.5).abs() - (n * 0.5 - r),
        (y - n * 0.5).abs() - (n * 0.5 - r),
    );
    let outside = (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt();
    outside + dx.max(dy).min(0.0) - r
}

/// The mark itself, in SVG units: two lenses with filled eyes, a bridge, and
/// the two frame arms. Stroke widths match the source at 1.6.
fn glasses(x: f32, y: f32, w: f32, arms: bool) -> bool {
    for cx in [10.0, 30.0] {
        // Lens rim.
        let d = ((x - cx).powi(2) + (y - 9.0).powi(2)).sqrt();
        if (d - 7.0).abs() <= w {
            return true;
        }
        // The eye. The source draws a leaf with two beziers; at icon sizes an
        // ellipse of the same mass is indistinguishable and exact.
        if ((x - cx) / 5.0).powi(2) + ((y - 9.1) / 3.1).powi(2) <= 1.0 {
            return true;
        }
    }

    if arms && (y - 9.0).abs() <= w && ((0.0..=3.0).contains(&x) || (37.0..=40.0).contains(&x)) {
        return true;
    }

    // Bridge: the quadratic (17,9) → (20,6) → (23,9), walked as a polyline.
    let steps = 24;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let bx = (1.0 - t).powi(2) * 17.0 + 2.0 * (1.0 - t) * t * 20.0 + t * t * 23.0;
        let by = (1.0 - t).powi(2) * 9.0 + 2.0 * (1.0 - t) * t * 6.0 + t * t * 9.0;
        if ((x - bx).powi(2) + (y - by).powi(2)).sqrt() <= w {
            return true;
        }
    }
    false
}

// -------------------------------------------------------------------- .ico

/// Every size Explorer might ask for, from the list view to the 256px preview.
const ICO_SIZES: [u32; 6] = [16, 32, 48, 64, 128, 256];

/// Write a Windows `.ico`. Entries are 32-bit BMPs rather than PNGs: the BMP
/// layout is a header and two bitmaps, where PNG would mean shipping an encoder
/// for a file that gets written once.
pub fn write_ico(path: &Path) -> io::Result<()> {
    let images: Vec<(u32, Vec<u8>)> = ICO_SIZES.iter().map(|&s| (s, bmp(s))).collect();

    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // type: icon
    out.extend_from_slice(&(images.len() as u16).to_le_bytes());

    let mut offset = 6 + 16 * images.len() as u32;
    for (size, data) in &images {
        // 256 is written as 0; the field is one byte wide.
        let dim = if *size == 256 { 0u8 } else { *size as u8 };
        out.push(dim);
        out.push(dim);
        out.push(0); // palette size
        out.push(0); // reserved
        out.extend_from_slice(&1u16.to_le_bytes()); // planes
        out.extend_from_slice(&32u16.to_le_bytes()); // bpp
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset += data.len() as u32;
    }
    for (_, data) in &images {
        out.extend_from_slice(data);
    }

    let mut file = std::fs::File::create(path)?;
    file.write_all(&out)
}

/// One icon entry: a BITMAPINFOHEADER, then bottom-up BGRA, then the 1-bit
/// mask Windows still requires even when the alpha channel carries the shape.
fn bmp(size: u32) -> Vec<u8> {
    let px = rgba(size);
    let mut out = Vec::new();

    out.extend_from_slice(&40u32.to_le_bytes()); // header size
    out.extend_from_slice(&(size as i32).to_le_bytes());
    out.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // colour + mask
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 24]); // compression through clr_important

    for y in (0..size).rev() {
        for x in 0..size {
            let i = ((y * size + x) * 4) as usize;
            out.extend_from_slice(&[px[i + 2], px[i + 1], px[i], px[i + 3]]);
        }
    }

    // AND mask, rows padded to four bytes. All zero: alpha decides.
    let row = size.div_ceil(32) * 4;
    out.extend(vec![0u8; (row * size) as usize]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regenerates the shortcut's icon as a side effect, so the committed
    /// `.ico` can never drift from the code that draws the window icon. Also
    /// the only exercise the ICO writer gets.
    #[test]
    fn writes_the_shortcut_icon() {
        let path = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/karin.ico"));
        write_ico(path).expect("write the icon");
        let bytes = std::fs::read(path).expect("read it back");

        assert_eq!(&bytes[..4], &[0, 0, 1, 0], "ICONDIR magic");
        assert_eq!(bytes[4], ICO_SIZES.len() as u8, "one entry per size");
        // Every entry must point inside the file and carry a whole bitmap.
        for i in 0..ICO_SIZES.len() {
            let e = 6 + i * 16;
            let len = u32::from_le_bytes(bytes[e + 8..e + 12].try_into().unwrap()) as usize;
            let at = u32::from_le_bytes(bytes[e + 12..e + 16].try_into().unwrap()) as usize;
            assert!(at + len <= bytes.len(), "entry {i} runs past the end");
            assert_eq!(
                u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()),
                40
            );
        }
    }

    #[test]
    fn the_mark_is_drawn_and_not_blank() {
        let px = rgba(48);
        let red = px
            .chunks(4)
            .filter(|p| p[0] > 180 && p[1] < 90 && p[2] < 90 && p[3] > 200)
            .count();
        let clear = px.chunks(4).filter(|p| p[3] < 40).count();
        assert!(red > 40, "the glasses should cover real pixels, got {red}");
        assert!(
            clear > 40,
            "the tile's corners should be rounded, got {clear}"
        );
    }
}
