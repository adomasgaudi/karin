//! The Claude and Codex marks, drawn straight onto the canvas.
//!
//! egui has no image loader in this build and adding one would mean a decoder
//! crate plus bundled asset bytes for two glyphs that are a starburst and a
//! ring. Both are a handful of primitives, so the painter draws them and the
//! binary stays dependency-free.

use std::path::Path;

use egui::{Color32, Rect, Sense, Shape, Stroke, Ui, Vec2};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Claude,
    Codex,
    Unknown,
}

pub fn source_of(path: &Path) -> Source {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.contains("/.claude/") {
        Source::Claude
    } else if s.contains("/.codex/") {
        Source::Codex
    } else {
        Source::Unknown
    }
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Claude => "Anthropic Claude",
            Source::Codex => "OpenAI Codex",
            Source::Unknown => "unknown source",
        }
    }
}

/// Reserve a square the height of a text row and paint the mark in it.
pub fn draw(ui: &mut Ui, source: Source) {
    let size = ui.text_style_height(&egui::TextStyle::Body) * 0.82;
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    if ui.is_rect_visible(rect) {
        paint(ui, rect, source);
    }
    response.on_hover_text(source.label());
}

fn paint(ui: &Ui, rect: Rect, source: Source) {
    let painter = ui.painter();
    let c = rect.center();
    let r = rect.width() * 0.5;
    match source {
        // Anthropic's burst: tapered spokes around a centre, in Claude orange.
        Source::Claude => {
            let color = Color32::from_rgb(217, 119, 87);
            for i in 0..6 {
                let a = std::f32::consts::PI * i as f32 / 6.0;
                let (sin, cos) = a.sin_cos();
                let arm = Vec2::new(cos, sin) * r;
                painter.line_segment([c - arm, c + arm], Stroke::new((r * 0.34).max(1.0), color));
            }
        }
        // OpenAI's knot, reduced to its silhouette: a ring with a solid centre.
        Source::Codex => {
            let color = if ui.visuals().dark_mode {
                Color32::from_gray(215)
            } else {
                Color32::from_gray(55)
            };
            painter.circle_stroke(c, r * 0.86, Stroke::new((r * 0.3).max(1.0), color));
            painter.circle_filled(c, r * 0.3, color);
        }
        Source::Unknown => {
            let color = ui.visuals().weak_text_color();
            painter.add(Shape::circle_stroke(
                c,
                r * 0.7,
                Stroke::new(1.0_f32, color),
            ));
        }
    }
}
