use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::index::{self, Snapshot};

/// Never load more than this from the end of a file; session logs grow unbounded.
const TAIL_BYTES: u64 = 8 * 1024 * 1024;

#[derive(PartialEq, Clone, Copy)]
enum Mode {
    Recent,
    Tree,
}

struct Doc {
    path: Option<PathBuf>,
    stamp: (SystemTime, u64),
    lines: Vec<String>,
    truncated: bool,
    err: Option<String>,
    loaded_in: f32,
}

impl Default for Doc {
    fn default() -> Self {
        Self {
            path: None,
            stamp: (UNIX_EPOCH, 0),
            lines: Vec::new(),
            truncated: false,
            err: None,
            loaded_in: 0.0,
        }
    }
}

pub struct App {
    shared: index::Shared,
    snap: Snapshot,
    mode: Mode,
    filter: String,
    expanded: HashSet<PathBuf>,
    selected: Option<PathBuf>,
    doc: Doc,
    follow: bool,
    latency_ms: f32,
    scanning: bool,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        style(&cc.egui_ctx);

        let ctx = cc.egui_ctx.clone();
        let shared = index::start(index::default_roots(), move || ctx.request_repaint());

        let mut expanded = HashSet::new();
        for root in index::default_roots() {
            expanded.insert(root);
        }

        Self {
            shared,
            snap: Snapshot::default(),
            mode: Mode::Recent,
            filter: String::new(),
            expanded,
            selected: None,
            doc: Doc::default(),
            follow: true,
            latency_ms: 0.0,
            scanning: true,
        }
    }

    /// Pull a new snapshot only when the index actually moved.
    fn sync(&mut self) {
        let ix = self.shared.lock().unwrap();
        self.scanning = ix.scanning;
        if ix.generation == self.snap.generation && !self.snap.roots.is_empty() {
            return;
        }
        if let Some(t) = ix.last_event {
            self.latency_ms = t.elapsed().as_secs_f32() * 1000.0;
        }
        self.snap = index::snapshot(&ix);
    }

    fn reload_if_stale(&mut self) {
        let Some(path) = self.selected.clone() else { return };
        let stamp = self
            .snap
            .by_path
            .get(&path)
            .map(|r| (r.mtime, r.size))
            .unwrap_or((UNIX_EPOCH, 0));
        if self.doc.path.as_ref() == Some(&path) && self.doc.stamp == stamp {
            return;
        }
        self.doc = load(&path, stamp);
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.sync();
        self.reload_if_stale();
        // Only so the "3s ago" column keeps ticking; real updates come from the watcher.
        ctx.request_repaint_after(std::time::Duration::from_secs(1));

        egui::TopBottomPanel::top("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(2.0);
                ui.label(egui::RichText::new("karin-rs").strong());
                ui.separator();
                ui.selectable_value(&mut self.mode, Mode::Recent, "recent");
                ui.selectable_value(&mut self.mode, Mode::Tree, "tree");
                ui.separator();
                ui.add(
                    egui::TextEdit::singleline(&mut self.filter)
                        .hint_text("filter")
                        .desired_width(220.0),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.add_space(4.0);
                    ui.label(dim(&format!("{} files", self.snap.by_path.len())));
                    ui.separator();
                    if self.scanning {
                        ui.label(dim("scanning…"));
                    } else {
                        ui.label(dim(&format!("event→ui {:.1} ms", self.latency_ms)));
                    }
                });
            });
            ui.add_space(2.0);
        });

        egui::SidePanel::left("files")
            .default_width(360.0)
            .width_range(200.0..=700.0)
            .show(ctx, |ui| {
                let row_h = ui.text_style_height(&egui::TextStyle::Body) + 3.0;
                let needle = self.filter.to_lowercase();
                let mut pick: Option<PathBuf> = None;

                match self.mode {
                    Mode::Recent => {
                        let rows: Vec<&index::FileRec> = self
                            .snap
                            .recent
                            .iter()
                            .filter(|r| {
                                needle.is_empty()
                                    || r.path.to_string_lossy().to_lowercase().contains(&needle)
                            })
                            .collect();
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show_rows(
                            ui,
                            row_h,
                            rows.len(),
                            |ui, range| {
                                for rec in &rows[range] {
                                    let selected = self.selected.as_ref() == Some(&rec.path);
                                    let label = format!("{}  {}", age(rec.mtime), rec.name);
                                    if ui.selectable_label(selected, label).clicked() {
                                        pick = Some(rec.path.clone());
                                    }
                                }
                            },
                        );
                    }
                    Mode::Tree => {
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
                            let roots = self.snap.roots.clone();
                            for root in &roots {
                                draw_dir(
                                    ui,
                                    &self.snap,
                                    root,
                                    0,
                                    &needle,
                                    &mut self.expanded,
                                    &self.selected,
                                    &mut pick,
                                );
                            }
                        });
                    }
                }

                if let Some(p) = pick {
                    self.selected = Some(p);
                }
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            let Some(path) = self.selected.clone() else {
                ui.centered_and_justified(|ui| ui.label(dim("pick a file")));
                return;
            };

            ui.horizontal(|ui| {
                ui.label(egui::RichText::new(short(&path)).monospace());
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.checkbox(&mut self.follow, "follow");
                    ui.separator();
                    ui.label(dim(&format!(
                        "{} lines · {} · read {:.1} ms{}",
                        self.doc.lines.len(),
                        bytes(self.doc.stamp.1),
                        self.doc.loaded_in,
                        if self.doc.truncated { " · tail" } else { "" }
                    )));
                });
            });
            ui.separator();

            if let Some(err) = &self.doc.err {
                ui.colored_label(egui::Color32::from_rgb(220, 110, 110), err);
                return;
            }

            let row_h = ui.text_style_height(&egui::TextStyle::Monospace);
            let gutter = egui::Color32::from_gray(95);
            let digits = digits_for(self.doc.lines.len());

            egui::ScrollArea::both()
                .auto_shrink([false; 2])
                .stick_to_bottom(self.follow)
                .show_rows(ui, row_h, self.doc.lines.len(), |ui, range| {
                    ui.set_min_width(ui.available_width());
                    for i in range {
                        let mut job = egui::text::LayoutJob::default();
                        job.wrap.max_width = f32::INFINITY;
                        job.append(
                            &format!("{:>w$}  ", i + 1, w = digits),
                            0.0,
                            fmt(gutter),
                        );
                        job.append(&self.doc.lines[i], 0.0, fmt(ui.visuals().text_color()));
                        ui.label(job);
                    }
                });
        });
    }
}

// ------------------------------------------------------------------ drawing

#[allow(clippy::too_many_arguments)]
fn draw_dir(
    ui: &mut egui::Ui,
    snap: &Snapshot,
    dir: &Path,
    depth: usize,
    needle: &str,
    expanded: &mut HashSet<PathBuf>,
    selected: &Option<PathBuf>,
    pick: &mut Option<PathBuf>,
) {
    let Some(node) = snap.dirs.get(dir) else { return };
    let open = expanded.contains(dir) || !needle.is_empty();
    let indent = depth as f32 * 12.0;

    ui.horizontal(|ui| {
        ui.add_space(indent);
        let arrow = if open { "▾" } else { "▸" };
        let name = if depth == 0 {
            short(dir)
        } else {
            dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
        };
        if ui
            .selectable_label(false, format!("{arrow} {name}  ({})", node.count))
            .clicked()
        {
            if !expanded.remove(dir) {
                expanded.insert(dir.to_path_buf());
            }
        }
    });

    if !open {
        return;
    }
    for sub in &node.subdirs {
        draw_dir(ui, snap, sub, depth + 1, needle, expanded, selected, pick);
    }
    for f in &node.files {
        let Some(rec) = snap.by_path.get(f) else { continue };
        if !needle.is_empty() && !rec.path.to_string_lossy().to_lowercase().contains(needle) {
            continue;
        }
        ui.horizontal(|ui| {
            ui.add_space(indent + 12.0);
            let is_sel = selected.as_ref() == Some(f);
            if ui
                .selectable_label(is_sel, format!("{}  {}", age(rec.mtime), rec.name))
                .clicked()
            {
                *pick = Some(f.clone());
            }
        });
    }
}

// ------------------------------------------------------------------- loading

fn load(path: &Path, stamp: (SystemTime, u64)) -> Doc {
    let t0 = Instant::now();
    let mut doc = Doc { path: Some(path.to_path_buf()), stamp, ..Default::default() };

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            doc.err = Some(e.to_string());
            return doc;
        }
    };

    let mut buf = Vec::new();
    if stamp.1 > TAIL_BYTES {
        doc.truncated = true;
        let _ = file.seek(SeekFrom::End(-(TAIL_BYTES as i64)));
    }
    if let Err(e) = file.read_to_end(&mut buf) {
        doc.err = Some(e.to_string());
        return doc;
    }

    doc.lines = String::from_utf8_lossy(&buf)
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_owned())
        .collect();
    doc.loaded_in = t0.elapsed().as_secs_f32() * 1000.0;
    doc
}

// -------------------------------------------------------------------- bits

fn style(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(6.0, 3.0);
    style.spacing.button_padding = egui::vec2(4.0, 1.0);
    style.visuals.panel_fill = egui::Color32::from_gray(24);
    style.visuals.extreme_bg_color = egui::Color32::from_gray(18);
    ctx.set_style(style);
}

fn fmt(color: egui::Color32) -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color,
        ..Default::default()
    }
}

fn dim(s: &str) -> egui::RichText {
    egui::RichText::new(s).color(egui::Color32::from_gray(130)).small()
}

fn digits_for(n: usize) -> usize {
    n.max(1).to_string().len()
}

fn short(path: &Path) -> String {
    let home = index::home();
    match path.strip_prefix(&home) {
        Ok(rest) => format!("~/{}", rest.to_string_lossy().replace('\\', "/")),
        Err(_) => path.to_string_lossy().replace('\\', "/"),
    }
}

fn bytes(n: u64) -> String {
    match n {
        n if n < 1024 => format!("{n} B"),
        n if n < 1024 * 1024 => format!("{:.0} KB", n as f64 / 1024.0),
        n => format!("{:.1} MB", n as f64 / (1024.0 * 1024.0)),
    }
}

fn age(t: SystemTime) -> String {
    let secs = SystemTime::now().duration_since(t).map(|d| d.as_secs()).unwrap_or(0);
    match secs {
        s if s < 60 => format!("{s:>3}s"),
        s if s < 3600 => format!("{:>3}m", s / 60),
        s if s < 86400 => format!("{:>3}h", s / 3600),
        s => format!("{:>3}d", s / 86400),
    }
}
