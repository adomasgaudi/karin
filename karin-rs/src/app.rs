use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::index::{self, Snapshot};
use crate::meta;
use crate::{jsonview, logo, manifest, records};

/// How often the manifest is rewritten while the app is open, so a crash costs
/// at most this much re-reading on the next launch.
const SAVE_EVERY: std::time::Duration = std::time::Duration::from_secs(30);

/// Never load more than this from the end of a file; session logs grow unbounded.
const TAIL_BYTES: u64 = 8 * 1024 * 1024;

/// Fresh session files we're willing to peek into per frame, so opening a
/// thousand-file folder fills its titles over a few frames instead of stalling.
const TITLE_BUDGET: u32 = 24;

/// Resolved session titles; `None` means "read it, found nothing".
type Titles = HashMap<PathBuf, Option<String>>;

/// Record rows drawn at once. Well past any real session; the cap only stops a
/// pathological file from freezing a frame.
const MAX_ROWS: usize = 4000;

/// How the selected file is shown, in three steps away from the file itself:
/// the conversation, every record, or the literal bytes.
#[derive(PartialEq, Clone, Copy)]
enum Pane {
    /// Just the conversation — prompts, replies, and one line per tool.
    Clean,
    /// Every record, accented and expandable. Nothing hidden, only quietened.
    Structured,
    /// The file as written.
    Raw,
}

/// Characters of one message the clean view will draw before clipping. A reply
/// runs long on purpose; a pasted build log does not need to be re-read here.
const CLEAN_BODY_MAX: usize = 8000;

#[derive(PartialEq, Clone, Copy)]
enum Mode {
    Recent,
    Project,
    Tree,
}

#[derive(PartialEq, Clone, Copy)]
enum Theme {
    Dark,
    Light,
}

/// How every list orders itself: newest write first, or folder/file name.
#[derive(PartialEq, Clone, Copy)]
enum SortBy {
    Recent,
    Name,
}

/// One project folder — the directory a session file actually sits in.
/// For Claude that is `projects/<project>`; for Codex, `sessions/<y>/<m>/<d>`.
struct Group {
    dir: PathBuf,
    label: String,
    /// The working directory the sessions ran in, when the file records one.
    cwd: Option<PathBuf>,
    files: Vec<index::FileRec>,
    mtime: SystemTime,
}

struct Doc {
    path: Option<PathBuf>,
    stamp: (SystemTime, u64),
    lines: Vec<String>,
    records: Vec<records::Record>,
    truncated: bool,
    err: Option<String>,
    loaded_in: f32,
    /// Lines parsed this reload — 0 when an append reused the previous parse.
    parsed: usize,
}

impl Default for Doc {
    fn default() -> Self {
        Self {
            path: None,
            stamp: (UNIX_EPOCH, 0),
            lines: Vec::new(),
            records: Vec::new(),
            truncated: false,
            err: None,
            loaded_in: 0.0,
            parsed: 0,
        }
    }
}

pub struct App {
    shared: index::Shared,
    snap: Snapshot,
    mode: Mode,
    sort: SortBy,
    theme: Theme,
    filter: String,
    expanded: HashSet<PathBuf>,
    /// Project groups start open, so only the closed ones are worth remembering.
    collapsed: HashSet<PathBuf>,
    groups: Vec<Group>,
    /// (snapshot generation, sort) the cached groups were built from.
    groups_key: Option<(u64, SortBy)>,
    /// Session file → the cwd it ran in. Read once, never re-read.
    cwds: HashMap<PathBuf, Option<PathBuf>>,
    titles: Titles,
    selected: Option<PathBuf>,
    doc: Doc,
    pane: Pane,
    show_changelog: bool,
    /// Whether the session list is on screen. Off, the transcript gets the
    /// whole window — the only way to read wide JSON on a small screen.
    sidebar: bool,
    follow: bool,
    latency_ms: f32,
    scanning: bool,
    /// Duration of the last full walk — what the manifest saves on every launch.
    scan_ms: f32,
    last_save: Instant,
    /// What the manifest on disk was written from: the index generation plus
    /// how many titles and cwds were resolved. Titles fill in over later frames
    /// without moving the generation, so they need their own term.
    saved_key: (u64, usize, usize),
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let (theme, sort, pane) = load_prefs();
        style(&cc.egui_ctx, theme);

        // The manifest is read before anything else: it is what makes the first
        // frame show a full list instead of an empty pane behind a scan.
        let cached = manifest::load();
        let mut cwds = HashMap::new();
        let mut titles = Titles::new();
        for (path, entry) in &cached {
            if let Some(cwd) = entry.cwd.clone() {
                cwds.insert(path.clone(), cwd);
            }
            if let Some(title) = entry.title.clone() {
                titles.insert(path.clone(), title);
            }
        }

        let ctx = cc.egui_ctx.clone();
        let shared = index::start(index::default_roots(), &cached, move || {
            ctx.request_repaint()
        });

        let mut expanded = HashSet::new();
        for root in index::default_roots() {
            expanded.insert(root);
        }

        Self {
            shared,
            snap: Snapshot::default(),
            mode: Mode::Recent,
            sort,
            theme,
            filter: String::new(),
            expanded,
            collapsed: HashSet::new(),
            groups: Vec::new(),
            groups_key: None,
            cwds,
            titles,
            // `--open <file>` preselects a session, so a rendering bug can be
            // reproduced from the command line instead of by clicking.
            selected: std::env::args()
                .skip_while(|a| a != "--open")
                .nth(1)
                .map(PathBuf::from),
            doc: Doc::default(),
            pane,
            show_changelog: false,
            sidebar: true,
            follow: true,
            latency_ms: 0.0,
            scanning: true,
            scan_ms: 0.0,
            last_save: Instant::now(),
            saved_key: (0, 0, 0),
        }
    }

    /// Patch the snapshot from the index. Cheap by design: a live session's
    /// append touches one file, one folder chain, and nothing else.
    fn sync(&mut self) {
        let mut ix = self.shared.lock().unwrap();
        self.scanning = ix.scanning;
        self.scan_ms = ix.scan_ms;
        if ix.generation == self.snap.generation && !ix.rebuilt {
            return;
        }
        if let Some(t) = ix.last_event {
            self.latency_ms = t.elapsed().as_secs_f32() * 1000.0;
        }
        index::sync(&mut self.snap, &mut ix);
    }

    /// Write everything this run learned — sizes, working directories, opening
    /// prompts — so the next launch never opens these transcripts again.
    fn cache_key(&self) -> (u64, usize, usize) {
        (self.snap.generation, self.titles.len(), self.cwds.len())
    }

    fn save_manifest(&mut self) {
        self.saved_key = self.cache_key();
        self.last_save = Instant::now();
        let rows: Vec<(PathBuf, manifest::Entry)> = self
            .snap
            .by_path
            .values()
            .map(|rec| {
                (
                    rec.path.clone(),
                    manifest::Entry {
                        mtime: rec.mtime,
                        size: rec.size,
                        cwd: self.cwds.get(&rec.path).cloned(),
                        title: self.titles.get(&rec.path).cloned(),
                    },
                )
            })
            .collect();
        std::thread::spawn(move || manifest::save(rows.into_iter()));
    }

    /// Regroup only when the index moved or the sort changed — and only while
    /// the project view is actually on screen, since grouping is the one part
    /// of a repaint that still touches every file.
    fn ensure_groups(&mut self) {
        if self.mode != Mode::Project {
            return;
        }
        let key = (self.snap.generation, self.sort);
        if self.groups_key == Some(key) {
            return;
        }
        self.groups = build_groups(&self.snap, self.sort, &mut self.cwds);
        self.groups_key = Some(key);
    }

    fn reload_if_stale(&mut self) {
        let Some(path) = self.selected.clone() else {
            return;
        };
        let stamp = self
            .snap
            .by_path
            .get(&path)
            .map(|r| (r.mtime, r.size))
            .unwrap_or((UNIX_EPOCH, 0));
        if self.doc.path.as_ref() == Some(&path) && self.doc.stamp == stamp {
            return;
        }
        let prev = std::mem::take(&mut self.doc);
        self.doc = load(&path, stamp, prev);
    }

    /// The working directory of the selected session, for shortening paths.
    fn root(&self) -> Option<&str> {
        let path = self.selected.as_ref()?;
        self.cwds.get(path)?.as_ref()?.to_str()
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.sync();
        self.ensure_groups();
        self.reload_if_stale();
        if !self.scanning
            && self.last_save.elapsed() > SAVE_EVERY
            && self.cache_key() != self.saved_key
        {
            self.save_manifest();
        }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::B)) {
            self.sidebar = !self.sidebar;
        }
        // Only so the "3s ago" column keeps ticking; real updates come from the watcher.
        ctx.request_repaint_after(std::time::Duration::from_secs(1));

        egui::TopBottomPanel::top("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(2.0);
                // A narrow window has to be able to give the whole width to the
                // transcript; the list is the part you can do without.
                if ui
                    .selectable_label(self.sidebar, "☰")
                    .on_hover_text("show/hide the session list  (Ctrl+B)")
                    .clicked()
                {
                    self.sidebar = !self.sidebar;
                }
                ui.label(egui::RichText::new("karin-rs").strong());
                ui.label(dim(ui, crate::APP_VERSION));
                ui.separator();
                ui.selectable_value(&mut self.mode, Mode::Recent, "recent");
                ui.selectable_value(&mut self.mode, Mode::Project, "project");
                ui.selectable_value(&mut self.mode, Mode::Tree, "tree");
                ui.separator();
                let sort_was = self.sort;
                let pane_was = self.pane;
                ui.selectable_value(&mut self.sort, SortBy::Recent, "newest");
                ui.selectable_value(&mut self.sort, SortBy::Name, "A-Z");
                ui.separator();
                ui.add(
                    egui::TextEdit::singleline(&mut self.filter)
                        .hint_text("filter")
                        .desired_width(220.0),
                );
                // Right-aligned by hand: a nested right-to-left layout inside this
                // row draws nothing once the row is this full, so pad instead.
                const RIGHT_W: f32 = 260.0;
                ui.add_space((ui.available_width() - RIGHT_W).max(8.0));

                if ui
                    .button("refresh")
                    .on_hover_text("re-scan both roots and reload this file")
                    .clicked()
                {
                    let ctx = ctx.clone();
                    index::rescan(&self.shared, move || ctx.request_repaint());
                    // Force the reload path to run even if size and mtime match.
                    self.doc = Doc::default();
                }
                ui.separator();

                let theme_was = self.theme;
                ui.selectable_value(&mut self.theme, Theme::Dark, "dark");
                ui.selectable_value(&mut self.theme, Theme::Light, "light");
                ui.separator();
                let status = if self.scanning {
                    dim(ui, "verifying…")
                } else {
                    dim(ui, &format!("event→ui {:.1} ms", self.latency_ms))
                };
                ui.label(status)
                    .on_hover_text(format!("last full walk: {:.0} ms", self.scan_ms));
                ui.separator();
                let files = dim(ui, &format!("{} files", self.snap.by_path.len()));
                ui.label(files);
                if self.theme != theme_was {
                    style(ctx, self.theme);
                }
                if self.theme != theme_was || self.sort != sort_was || self.pane != pane_was {
                    save_prefs(self.theme, self.sort, self.pane);
                }
            });
            ui.add_space(2.0);
        });

        egui::SidePanel::left("files")
            .resizable(true)
            .default_width(360.0)
            // Narrow enough to be a strip, wide enough to read a long prompt.
            .width_range(120.0..=900.0)
            .show_animated(ctx, self.sidebar, |ui| {
                let row_h = ui.text_style_height(&egui::TextStyle::Body) + 3.0;
                let needle = self.filter.to_lowercase();
                let mut pick: Option<PathBuf> = None;
                let mut budget = TITLE_BUDGET;

                match self.mode {
                    Mode::Recent => {
                        let mut rows: Vec<&index::FileRec> = self
                            .snap
                            .recent
                            .iter()
                            .filter(|r| {
                                needle.is_empty()
                                    || r.path.to_string_lossy().to_lowercase().contains(&needle)
                            })
                            .collect();
                        if self.sort == SortBy::Name {
                            rows.sort_by(|a, b| by_name(&a.name, &b.name));
                        }
                        let titles = &mut self.titles;
                        let selected = &self.selected;
                        egui::ScrollArea::vertical()
                            .auto_shrink([false; 2])
                            .show_rows(ui, row_h, rows.len(), |ui, range| {
                                for rec in &rows[range] {
                                    let is_sel = selected.as_ref() == Some(&rec.path);
                                    if session_row(ui, titles, &mut budget, rec, is_sel, 2.0) {
                                        pick = Some(rec.path.clone());
                                    }
                                }
                            });
                    }
                    Mode::Project => {
                        egui::ScrollArea::vertical()
                            .auto_shrink([false; 2])
                            .show(ui, |ui| {
                                let groups = &self.groups;
                                let collapsed = &mut self.collapsed;
                                let selected = &self.selected;
                                let titles = &mut self.titles;
                                for g in groups {
                                    let rows: Vec<&index::FileRec> = g
                                        .files
                                        .iter()
                                        .filter(|r| {
                                            needle.is_empty()
                                                || r.path
                                                    .to_string_lossy()
                                                    .to_lowercase()
                                                    .contains(&needle)
                                        })
                                        .collect();
                                    if rows.is_empty() {
                                        continue;
                                    }
                                    // A live filter overrides collapse: hits must be visible.
                                    let open = !collapsed.contains(&g.dir) || !needle.is_empty();
                                    let arrow = if open { "▾" } else { "▸" };
                                    let head = format!(
                                        "{arrow} {}  ({})  {}",
                                        g.label,
                                        rows.len(),
                                        age(g.mtime)
                                    );
                                    if ui.selectable_label(false, head).clicked()
                                        && !collapsed.remove(&g.dir)
                                    {
                                        collapsed.insert(g.dir.clone());
                                    }
                                    if !open {
                                        continue;
                                    }
                                    for rec in rows {
                                        let is_sel = selected.as_ref() == Some(&rec.path);
                                        if session_row(ui, titles, &mut budget, rec, is_sel, 12.0) {
                                            pick = Some(rec.path.clone());
                                        }
                                    }
                                }
                            });
                    }
                    Mode::Tree => {
                        egui::ScrollArea::vertical()
                            .auto_shrink([false; 2])
                            .show(ui, |ui| {
                                let roots = self.snap.roots.clone();
                                let titles = &mut self.titles;
                                for root in &roots {
                                    draw_dir(
                                        ui,
                                        &self.snap,
                                        root,
                                        0,
                                        &needle,
                                        self.sort,
                                        &mut self.expanded,
                                        &self.selected,
                                        titles,
                                        &mut budget,
                                        &mut pick,
                                    );
                                }
                            });
                    }
                }

                if let Some(p) = pick {
                    self.selected = Some(p);
                }
                // Titles ran out of budget this frame; come back for the rest.
                if budget == 0 {
                    ui.ctx().request_repaint();
                }
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            let Some(path) = self.selected.clone() else {
                ui.centered_and_justified(|ui| {
                    let t = dim(ui, "pick a file");
                    ui.label(t)
                });
                return;
            };

            // The view switch leads this row. Right-aligning it put it past the
            // edge of a very wide window, where it could not be found at all.
            ui.horizontal(|ui| {
                ui.selectable_value(&mut self.pane, Pane::Clean, "clean")
                    .on_hover_text("the conversation only");
                ui.selectable_value(&mut self.pane, Pane::Structured, "structured")
                    .on_hover_text("every record, accented and expandable");
                ui.selectable_value(&mut self.pane, Pane::Raw, "raw")
                    .on_hover_text("the file as written");
                ui.separator();
                ui.label(egui::RichText::new(short(&path)).monospace());
                ui.add_space((ui.available_width() - 260.0).max(8.0));
                let t = dim(
                    ui,
                    &format!(
                        "{} records · {} · read {:.1} ms{}",
                        self.doc.records.len(),
                        bytes(self.doc.stamp.1),
                        self.doc.loaded_in,
                        if self.doc.truncated { " · tail" } else { "" }
                    ),
                );
                ui.label(t);
                ui.separator();
                ui.checkbox(&mut self.follow, "follow");
            });
            ui.separator();

            if let Some(err) = &self.doc.err {
                let red = ui.visuals().error_fg_color;
                ui.colored_label(red, err);
                return;
            }

            match self.pane {
                Pane::Clean => show_clean(ui, &self.doc, self.follow),
                Pane::Structured => show_structured(ui, &self.doc, self.root(), self.follow),
                Pane::Raw => show_raw(ui, &self.doc, self.follow),
            }
        });

        egui::Area::new(egui::Id::new("changelog-button"))
            .anchor(egui::Align2::RIGHT_BOTTOM, egui::vec2(-12.0, -12.0))
            .show(ctx, |ui| {
                if ui
                    .small_button(format!("updates {}", crate::APP_VERSION))
                    .clicked()
                {
                    self.show_changelog = !self.show_changelog;
                }
            });

        if self.show_changelog {
            egui::Window::new("What's new")
                .open(&mut self.show_changelog)
                .default_width(390.0)
                .show(ctx, |ui| {
                    for entry in crate::changelog::CHANGELOG {
                        ui.horizontal(|ui| {
                            ui.strong(entry.title);
                            ui.label(dim(ui, entry.version));
                        });
                        ui.collapsing(entry.summary, |ui| {
                            if let Some(detail) = entry.detail {
                                ui.collapsing("details", |ui| {
                                    ui.label(detail);
                                });
                            }
                        });
                        ui.separator();
                    }
                });
        }
    }

    /// Last chance to record what this run learned.
    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        let rows: Vec<(PathBuf, manifest::Entry)> = self
            .snap
            .by_path
            .values()
            .map(|rec| {
                (
                    rec.path.clone(),
                    manifest::Entry {
                        mtime: rec.mtime,
                        size: rec.size,
                        cwd: self.cwds.get(&rec.path).cloned(),
                        title: self.titles.get(&rec.path).cloned(),
                    },
                )
            })
            .collect();
        // On the way out, write it here — a spawned thread may not outlive us.
        manifest::save(rows.into_iter());
    }
}

// -------------------------------------------------------------------- accent

/// One colour per shape, used as a left rule rather than a filled card — the
/// same choice old Karin made once a cycle's worth of boxes proved unreadable.
fn accent(ui: &egui::Ui, shape: records::Shape) -> egui::Color32 {
    let dark = ui.visuals().dark_mode;
    let (r, g, b) = match shape {
        records::Shape::User => (90, 165, 220),
        records::Shape::Assistant => (90, 195, 150),
        records::Shape::Thinking => (150, 150, 185),
        records::Shape::ToolCall => (205, 165, 95),
        records::Shape::ToolResult => (140, 140, 140),
        _ => return ui.visuals().weak_text_color(),
    };
    if dark {
        return egui::Color32::from_rgb(r, g, b);
    }
    // Light mode wants the same hue, darker. The arithmetic widens first: these
    // are u8 channels and 205 * 3 does not fit in one.
    let darken = |c: u8| (c as u16 * 3 / 4) as u8;
    egui::Color32::from_rgb(darken(r), darken(g), darken(b))
}

/// Lay out `content` indented, then draw the accent rule beside it. The rule
/// has to come second because its height is whatever the content turned out
/// to be.
fn ruled(ui: &mut egui::Ui, color: egui::Color32, content: impl FnOnce(&mut egui::Ui)) {
    ui.horizontal(|ui| {
        ui.add_space(10.0);
        let rect = ui
            .vertical(|ui| {
                ui.set_max_width((ui.available_width() - 8.0).max(120.0));
                content(ui);
            })
            .response
            .rect;
        ui.painter().vline(
            rect.left() - 5.0,
            rect.y_range(),
            egui::Stroke::new(2.0_f32, color),
        );
    });
}

// --------------------------------------------------------------- clean pane

/// The conversation and nothing else: what was asked, what was answered, and a
/// single quiet line wherever a tool ran. Everything the harness wrote to talk
/// to itself is dropped — see `records::Shape`.
fn show_clean(ui: &mut egui::Ui, doc: &Doc, follow: bool) {
    let rows: Vec<&records::Record> = doc
        .records
        .iter()
        .filter(|r| !r.shape.is_chatter())
        .collect();

    if rows.is_empty() {
        let t = dim(ui, "nothing conversational in this file — try structured");
        ui.label(t);
        return;
    }

    let start = rows.len().saturating_sub(MAX_ROWS);
    if start > 0 {
        let note = dim(
            ui,
            &format!("showing the last {MAX_ROWS} of {} messages", rows.len()),
        );
        ui.label(note);
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false; 2])
        .stick_to_bottom(follow)
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 2.0;
            for rec in &rows[start..] {
                clean_row(ui, rec);
            }
        });
}

fn clean_row(ui: &mut egui::Ui, rec: &records::Record) {
    use records::Shape;
    let color = accent(ui, rec.shape);

    match rec.shape {
        Shape::User | Shape::Assistant => {
            ui.add_space(7.0);
            ruled(ui, color, |ui| {
                ui.label(
                    egui::RichText::new(rec.shape.label())
                        .size(9.5)
                        .color(color),
                );
                let (text, clipped) = clip(&rec.body, CLEAN_BODY_MAX);
                let mut body = egui::RichText::new(text).size(12.5);
                if rec.shape == Shape::User {
                    body = body.strong();
                }
                ui.label(body);
                if clipped {
                    let t = dim(ui, "… clipped");
                    ui.label(t);
                }
            });
        }
        // A thought is worth knowing happened; reading it is opt-in.
        Shape::Thinking => ruled(ui, color, |ui| {
            let head = meta::truncate(&records::one_line(&rec.body, 400), 110);
            egui::CollapsingHeader::new(
                egui::RichText::new(format!("thinking · {head}"))
                    .size(10.5)
                    .color(color),
            )
            .id_salt(rec.line)
            .show(ui, |ui| {
                let (text, _) = clip(&rec.body, CLEAN_BODY_MAX);
                ui.label(egui::RichText::new(text).size(11.5));
            });
        }),
        // Tool traffic collapses to one line each — the shape of the work,
        // without the transcript of it.
        _ => ruled(ui, color, |ui| {
            ui.label(
                egui::RichText::new(&rec.preview)
                    .size(11.0)
                    .monospace()
                    .color(if rec.shape == Shape::ToolCall {
                        color
                    } else {
                        ui.visuals().weak_text_color()
                    }),
            );
        }),
    }
}

/// Long bodies get a head and a tail; the middle of a pasted log is never the
/// part anyone scrolls back for.
fn clip(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_owned(), false);
    }
    let head: String = text.chars().take(max * 3 / 4).collect();
    let tail: String = {
        let all: Vec<char> = text.chars().collect();
        all[all.len() - max / 4..].iter().collect()
    };
    (format!("{head}\n\n…\n\n{tail}"), true)
}

// ---------------------------------------------------------------- structured

/// Every record, one collapsed row each, expandable into a key→value tree.
/// Same shape as karin's RecordRow, minus the browser — but now accented by
/// what the record *is*, with the harness's bookkeeping pushed into the grey.
fn show_structured(ui: &mut egui::Ui, doc: &Doc, root: Option<&str>, follow: bool) {
    let rows: Vec<&records::Record> = doc.records.iter().filter(|r| r.kind != "blank").collect();
    let start = rows.len().saturating_sub(MAX_ROWS);
    if start > 0 {
        let note = dim(
            ui,
            &format!("showing the last {MAX_ROWS} of {} records", rows.len()),
        );
        ui.label(note);
    }
    egui::ScrollArea::vertical()
        .auto_shrink([false; 2])
        .stick_to_bottom(follow)
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 1.0;
            for rec in &rows[start..] {
                let color = accent(ui, rec.shape);
                ruled(ui, color, |ui| record_row(ui, rec, root));
            }
        });
}

fn record_row(ui: &mut egui::Ui, rec: &records::Record, root: Option<&str>) {
    let id = ui.make_persistent_id(rec.line);
    let state =
        egui::collapsing_header::CollapsingState::load_with_default_open(ui.ctx(), id, false);

    state
        .show_header(ui, |ui| {
            let no = egui::RichText::new(format!("{:>5}", rec.line))
                .monospace()
                .size(10.0)
                .color(ui.visuals().weak_text_color());
            ui.label(no);
            // The chip says what the record *is*; its own `type` is one hover
            // away, so the common case reads as English.
            ui.label(chip(ui, rec.shape.label(), accent(ui, rec.shape)))
                .on_hover_text(&rec.kind);
            let mut preview = egui::RichText::new(&rec.preview).size(11.5);
            if rec.shape.is_chatter() {
                preview = preview.color(ui.visuals().weak_text_color());
            }
            ui.add(egui::Label::new(preview).truncate());
        })
        .body(|ui| {
            let raw_id = id.with("raw");
            let mut raw = ui.data_mut(|d| d.get_temp::<bool>(raw_id).unwrap_or(false));
            ui.horizontal(|ui| {
                ui.add_space(18.0);
                if let Some(ts) = &rec.timestamp {
                    ui.label(dim(ui, ts));
                    ui.separator();
                }
                if ui
                    .small_button(if raw { "readable" } else { "raw json" })
                    .clicked()
                {
                    raw = !raw;
                    ui.data_mut(|d| d.insert_temp(raw_id, raw));
                }
                if ui.small_button("copy").clicked() {
                    let text = match &rec.value {
                        Some(v) => serde_json::to_string_pretty(v).unwrap_or_default(),
                        None => rec.preview.clone(),
                    };
                    ui.output_mut(|o| o.copied_text = text);
                }
            });
            ui.indent(id, |ui| match (&rec.value, raw) {
                // The chip already says the type; repeating it is noise.
                (Some(v), false) => jsonview::View { root }.show(ui, v, &["type"]),
                (Some(v), true) => {
                    let text = serde_json::to_string_pretty(v).unwrap_or_default();
                    ui.label(egui::RichText::new(text).monospace().size(11.0));
                }
                (None, _) => {
                    ui.label(egui::RichText::new(&rec.preview).monospace().size(11.0));
                }
            });
        });
}

/// A muted tag in the shape's own colour, tinted rather than filled so a long
/// column of them stays quiet.
fn chip(ui: &egui::Ui, text: &str, color: egui::Color32) -> egui::RichText {
    let alpha = if ui.visuals().dark_mode { 30 } else { 40 };
    let bg = egui::Color32::from_rgba_unmultiplied(color.r(), color.g(), color.b(), alpha);
    egui::RichText::new(format!("{text:>9}"))
        .monospace()
        .size(10.0)
        .color(color)
        .background_color(bg)
}

/// The literal file, line-numbered — kept for when the exact bytes matter.
fn show_raw(ui: &mut egui::Ui, doc: &Doc, follow: bool) {
    let row_h = ui.text_style_height(&egui::TextStyle::Monospace);
    let gutter = ui.visuals().weak_text_color();
    let text = ui.visuals().text_color();
    let digits = digits_for(doc.lines.len());

    egui::ScrollArea::both()
        .auto_shrink([false; 2])
        .stick_to_bottom(follow)
        .show_rows(ui, row_h, doc.lines.len(), |ui, range| {
            ui.set_min_width(ui.available_width());
            for i in range {
                let mut job = egui::text::LayoutJob::default();
                job.wrap.max_width = f32::INFINITY;
                job.append(&format!("{:>w$}  ", i + 1, w = digits), 0.0, fmt(gutter));
                job.append(&doc.lines[i], 0.0, fmt(text));
                ui.label(job);
            }
        });
}

// ------------------------------------------------------------------ grouping

/// Bucket every file by its recorded working directory, then order both levels.
fn build_groups(
    snap: &Snapshot,
    sort: SortBy,
    cwds: &mut HashMap<PathBuf, Option<PathBuf>>,
) -> Vec<Group> {
    let mut at: HashMap<PathBuf, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();

    for rec in &snap.recent {
        let physical_dir = rec
            .path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| rec.path.clone());
        let cwd = cwds
            .entry(rec.path.clone())
            .or_insert_with(|| meta::read(&rec.path).cwd)
            .clone();
        let dir = cwd.clone().unwrap_or(physical_dir);
        let i = *at.entry(dir.clone()).or_insert_with(|| {
            groups.push(Group {
                label: String::new(),
                dir: dir.clone(),
                cwd,
                files: Vec::new(),
                mtime: UNIX_EPOCH,
            });
            groups.len() - 1
        });
        groups[i].mtime = groups[i].mtime.max(rec.mtime);
        groups[i].files.push(rec.clone());
    }

    // The group key is already the recorded cwd when one exists. For files with
    // no metadata, it remains the physical transcript folder as a fallback.
    for g in &mut groups {
        g.label = group_label(g, &snap.roots);
    }
    dedupe_labels(&mut groups);

    for g in &mut groups {
        match sort {
            SortBy::Recent => g.files.sort_by_key(|r| std::cmp::Reverse(r.mtime)),
            SortBy::Name => g.files.sort_by(|a, b| by_name(&a.name, &b.name)),
        }
    }
    match sort {
        SortBy::Recent => groups.sort_by_key(|g| std::cmp::Reverse(g.mtime)),
        SortBy::Name => groups.sort_by(|a, b| by_name(&a.label, &b.label)),
    }
    groups
}

/// Use the actual project folder for both Claude and Codex sessions.
fn group_label(g: &Group, roots: &[PathBuf]) -> String {
    if let Some(name) = g.cwd.as_deref().and_then(leaf_name) {
        return name;
    }
    project_label(&g.dir, roots)
}

/// Two projects can share a folder name; widen only those to `parent/name`.
fn dedupe_labels(groups: &mut [Group]) {
    let mut seen: HashMap<String, usize> = HashMap::new();
    for g in groups.iter() {
        *seen.entry(g.label.clone()).or_insert(0) += 1;
    }
    for g in groups.iter_mut() {
        if seen.get(&g.label).copied().unwrap_or(0) < 2 {
            continue;
        }
        let Some(cwd) = g.cwd.as_deref() else {
            continue;
        };
        let (Some(parent), Some(name)) = (cwd.parent().and_then(leaf_name), leaf_name(cwd)) else {
            continue;
        };
        g.label = format!("{parent}/{name}");
    }
}

fn leaf_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    (!name.is_empty()).then_some(name)
}

/// `~/.claude/projects/<proj>` → `claude/<proj>`; keeps the source visible.
fn project_label(dir: &Path, roots: &[PathBuf]) -> String {
    for root in roots {
        let Ok(rest) = dir.strip_prefix(root) else {
            continue;
        };
        let tag = root_tag(root);
        let rest = rest.to_string_lossy().replace('\\', "/");
        return if rest.is_empty() {
            tag.to_owned()
        } else {
            format!("{tag} {rest}")
        };
    }
    short(dir)
}

fn root_tag(root: &Path) -> &'static str {
    let s = root.to_string_lossy().replace('\\', "/");
    if s.contains("/.claude/") {
        "claude"
    } else if s.contains("/.codex/") {
        "codex"
    } else {
        "files"
    }
}

fn by_name(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase())
}

/// One session in the list: whose agent wrote it, how long ago, and what it
/// was asked. Returns whether it was clicked.
fn session_row(
    ui: &mut egui::Ui,
    titles: &mut Titles,
    budget: &mut u32,
    rec: &index::FileRec,
    is_sel: bool,
    indent: f32,
) -> bool {
    let mut clicked = false;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 5.0;
        ui.add_space(indent);
        logo::draw(ui, logo::source_of(&rec.path));
        let label = row_label(titles, budget, rec);
        clicked = ui.selectable_label(is_sel, label).clicked();
    });
    clicked
}

/// A session row: its age, then its opening prompt. Reading that prompt costs a
/// file open, so unresolved rows fall back to the filename until a later frame
/// has budget for them.
fn row_label(titles: &mut Titles, budget: &mut u32, rec: &index::FileRec) -> String {
    let title = match titles.get(&rec.path) {
        Some(cached) => cached.clone(),
        None if *budget > 0 => {
            *budget -= 1;
            let found = meta::read(&rec.path).title;
            titles.insert(rec.path.clone(), found.clone());
            found
        }
        None => None,
    };
    format!(
        "{}  {}",
        age(rec.mtime),
        title.unwrap_or_else(|| stem(&rec.name))
    )
}

/// The filename without `.jsonl`, and without Codex's `rollout-<timestamp>-`
/// prefix — the age column already says when it ran.
fn stem(name: &str) -> String {
    let base = name.strip_suffix(".jsonl").unwrap_or(name);
    let base = base.strip_prefix("rollout-").unwrap_or(base);
    meta::truncate(base, 60)
}

// ------------------------------------------------------------------ drawing

#[allow(clippy::too_many_arguments)]
fn draw_dir(
    ui: &mut egui::Ui,
    snap: &Snapshot,
    dir: &Path,
    depth: usize,
    needle: &str,
    sort: SortBy,
    expanded: &mut HashSet<PathBuf>,
    selected: &Option<PathBuf>,
    titles: &mut Titles,
    budget: &mut u32,
    pick: &mut Option<PathBuf>,
) {
    let Some(node) = snap.dirs.get(dir) else {
        return;
    };
    let open = expanded.contains(dir) || !needle.is_empty();
    let indent = depth as f32 * 12.0;

    ui.horizontal(|ui| {
        ui.add_space(indent);
        let arrow = if open { "▾" } else { "▸" };
        let name = if depth == 0 {
            short(dir)
        } else {
            dir.file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        if ui
            .selectable_label(false, format!("{arrow} {name}  ({})", node.count))
            .clicked()
            && !expanded.remove(dir)
        {
            expanded.insert(dir.to_path_buf());
        }
    });

    if !open {
        return;
    }

    // The snapshot is already newest-first; only A-Z needs a per-frame reorder.
    let mut subdirs = node.subdirs.clone();
    let mut files = node.files.clone();
    if sort == SortBy::Name {
        subdirs.sort_by(|a, b| by_name(&leaf(a), &leaf(b)));
        files.sort_by(|a, b| by_name(&leaf(a), &leaf(b)));
    }

    for sub in &subdirs {
        draw_dir(
            ui,
            snap,
            sub,
            depth + 1,
            needle,
            sort,
            expanded,
            selected,
            titles,
            budget,
            pick,
        );
    }
    for f in &files {
        let Some(rec) = snap.by_path.get(f) else {
            continue;
        };
        if !needle.is_empty() && !rec.path.to_string_lossy().to_lowercase().contains(needle) {
            continue;
        }
        let is_sel = selected.as_ref() == Some(f);
        if session_row(ui, titles, budget, rec, is_sel, indent + 12.0) {
            *pick = Some(f.clone());
        }
    }
}

// ------------------------------------------------------------------- loading

fn load(path: &Path, stamp: (SystemTime, u64), prev: Doc) -> Doc {
    let t0 = Instant::now();
    let mut doc = Doc {
        path: Some(path.to_path_buf()),
        stamp,
        ..Default::default()
    };

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

    // A live session appends; re-parsing the whole tail on every write is the
    // loop that made the web app crawl. Keep the parse when the file only grew,
    // redoing the last known line since it may have been half-written.
    let keep = reusable(&prev, &doc);
    doc.records = prev.records;
    doc.records.truncate(keep);
    for (i, line) in doc.lines.iter().enumerate().skip(keep) {
        doc.records.push(records::parse_line(i + 1, line));
    }
    doc.parsed = doc.lines.len() - keep;
    doc.loaded_in = t0.elapsed().as_secs_f32() * 1000.0;
    doc
}

/// How many of `prev`'s records still describe `next` — 0 when anything moved.
fn reusable(prev: &Doc, next: &Doc) -> usize {
    if prev.path != next.path || prev.truncated || next.truncated {
        return 0;
    }
    let keep = prev.records.len().min(prev.lines.len()).saturating_sub(1);
    if keep == 0 || next.lines.len() < keep {
        return 0;
    }
    if prev.lines[..keep] != next.lines[..keep] {
        return 0;
    }
    keep
}

// --------------------------------------------------------------- preferences

fn prefs_path() -> PathBuf {
    index::home().join(".karin-rs.conf")
}

/// One tiny text file, so the window opens the way it was left. No serde.
fn load_prefs() -> (Theme, SortBy, Pane) {
    let (mut theme, mut sort, mut pane) = (Theme::Dark, SortBy::Recent, Pane::Clean);
    let Ok(text) = std::fs::read_to_string(prefs_path()) else {
        return (theme, sort, pane);
    };
    for line in text.lines() {
        match line.trim().split_once('=') {
            Some(("theme", "light")) => theme = Theme::Light,
            Some(("sort", "name")) => sort = SortBy::Name,
            Some(("pane", "structured")) => pane = Pane::Structured,
            Some(("pane", "raw")) => pane = Pane::Raw,
            _ => {}
        }
    }
    (theme, sort, pane)
}

fn save_prefs(theme: Theme, sort: SortBy, pane: Pane) {
    let text = format!(
        "theme={}\nsort={}\npane={}\n",
        match theme {
            Theme::Light => "light",
            Theme::Dark => "dark",
        },
        match sort {
            SortBy::Name => "name",
            SortBy::Recent => "recent",
        },
        match pane {
            Pane::Clean => "clean",
            Pane::Structured => "structured",
            Pane::Raw => "raw",
        }
    );
    let _ = std::fs::write(prefs_path(), text);
}

// -------------------------------------------------------------------- bits

fn style(ctx: &egui::Context, theme: Theme) {
    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(6.0, 3.0);
    style.spacing.button_padding = egui::vec2(4.0, 1.0);
    style.visuals = match theme {
        Theme::Dark => {
            let mut v = egui::Visuals::dark();
            v.panel_fill = egui::Color32::from_gray(24);
            v.extreme_bg_color = egui::Color32::from_gray(18);
            v
        }
        Theme::Light => {
            let mut v = egui::Visuals::light();
            v.panel_fill = egui::Color32::from_gray(246);
            v.extreme_bg_color = egui::Color32::from_gray(253);
            v
        }
    };
    ctx.set_style(style);
}

fn fmt(color: egui::Color32) -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::monospace(12.0),
        color,
        ..Default::default()
    }
}

/// Secondary text, taken from the active theme rather than a fixed gray.
fn dim(ui: &egui::Ui, s: &str) -> egui::RichText {
    egui::RichText::new(s)
        .color(ui.visuals().weak_text_color())
        .small()
}

fn digits_for(n: usize) -> usize {
    n.max(1).to_string().len()
}

fn leaf(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
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
    let secs = SystemTime::now()
        .duration_since(t)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    match secs {
        s if s < 60 => format!("{s:>3}s"),
        s if s < 3600 => format!("{:>3}m", s / 60),
        s if s < 86400 => format!("{:>3}h", s / 3600),
        s => format!("{:>3}d", s / 86400),
    }
}
