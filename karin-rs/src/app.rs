use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::index::{self, Snapshot};
use crate::meta;

/// Never load more than this from the end of a file; session logs grow unbounded.
const TAIL_BYTES: u64 = 8 * 1024 * 1024;

/// Fresh session files we're willing to peek into per frame, so opening a
/// thousand-file folder fills its titles over a few frames instead of stalling.
const TITLE_BUDGET: u32 = 24;

/// Resolved session titles; `None` means "read it, found nothing".
type Titles = HashMap<PathBuf, Option<String>>;

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
    sort: SortBy,
    theme: Theme,
    filter: String,
    expanded: HashSet<PathBuf>,
    /// Project groups start open, so only the closed ones are worth remembering.
    collapsed: HashSet<PathBuf>,
    groups: Vec<Group>,
    /// (snapshot generation, sort) the cached groups were built from.
    groups_key: Option<(u64, SortBy)>,
    /// Folder → the cwd its sessions ran in. Read once, never re-read.
    cwds: HashMap<PathBuf, Option<PathBuf>>,
    titles: Titles,
    selected: Option<PathBuf>,
    doc: Doc,
    follow: bool,
    latency_ms: f32,
    scanning: bool,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let (theme, sort) = load_prefs();
        style(&cc.egui_ctx, theme);

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
            sort,
            theme,
            filter: String::new(),
            expanded,
            collapsed: HashSet::new(),
            groups: Vec::new(),
            groups_key: None,
            cwds: HashMap::new(),
            titles: HashMap::new(),
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

    /// Regroup only when the index moved or the sort changed — not every frame.
    fn ensure_groups(&mut self) {
        let key = (self.snap.generation, self.sort);
        if self.groups_key == Some(key) {
            return;
        }
        self.groups = build_groups(&self.snap, self.sort, &mut self.cwds);
        self.groups_key = Some(key);
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
        self.ensure_groups();
        self.reload_if_stale();
        // Only so the "3s ago" column keeps ticking; real updates come from the watcher.
        ctx.request_repaint_after(std::time::Duration::from_secs(1));

        egui::TopBottomPanel::top("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(2.0);
                ui.label(egui::RichText::new("karin-rs").strong());
                ui.label(dim(ui, crate::APP_VERSION));
                ui.separator();
                ui.selectable_value(&mut self.mode, Mode::Recent, "recent");
                ui.selectable_value(&mut self.mode, Mode::Project, "project");
                ui.selectable_value(&mut self.mode, Mode::Tree, "tree");
                ui.separator();
                let sort_was = self.sort;
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

                let theme_was = self.theme;
                ui.selectable_value(&mut self.theme, Theme::Dark, "dark");
                ui.selectable_value(&mut self.theme, Theme::Light, "light");
                ui.separator();
                let status = if self.scanning {
                    dim(ui, "scanning…")
                } else {
                    dim(ui, &format!("event→ui {:.1} ms", self.latency_ms))
                };
                ui.label(status);
                ui.separator();
                let files = dim(ui, &format!("{} files", self.snap.by_path.len()));
                ui.label(files);
                if self.theme != theme_was {
                    style(ctx, self.theme);
                }
                if self.theme != theme_was || self.sort != sort_was {
                    save_prefs(self.theme, self.sort);
                }
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
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show_rows(
                            ui,
                            row_h,
                            rows.len(),
                            |ui, range| {
                                for rec in &rows[range] {
                                    let is_sel = selected.as_ref() == Some(&rec.path);
                                    let label = row_label(titles, &mut budget, rec);
                                    if ui.selectable_label(is_sel, label).clicked() {
                                        pick = Some(rec.path.clone());
                                    }
                                }
                            },
                        );
                    }
                    Mode::Project => {
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
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
                                if ui.selectable_label(false, head).clicked() && !collapsed.remove(&g.dir) {
                                    collapsed.insert(g.dir.clone());
                                }
                                if !open {
                                    continue;
                                }
                                for rec in rows {
                                    ui.horizontal(|ui| {
                                        ui.add_space(12.0);
                                        let is_sel = selected.as_ref() == Some(&rec.path);
                                        let label = row_label(titles, &mut budget, rec);
                                        if ui.selectable_label(is_sel, label).clicked() {
                                            pick = Some(rec.path.clone());
                                        }
                                    });
                                }
                            }
                        });
                    }
                    Mode::Tree => {
                        egui::ScrollArea::vertical().auto_shrink([false; 2]).show(ui, |ui| {
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

            ui.horizontal(|ui| {
                ui.label(egui::RichText::new(short(&path)).monospace());
                ui.add_space((ui.available_width() - 300.0).max(8.0));
                let t = dim(
                    ui,
                    &format!(
                        "{} lines · {} · read {:.1} ms{}",
                        self.doc.lines.len(),
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

            let row_h = ui.text_style_height(&egui::TextStyle::Monospace);
            let gutter = ui.visuals().weak_text_color();
            let text = ui.visuals().text_color();
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
                        job.append(&self.doc.lines[i], 0.0, fmt(text));
                        ui.label(job);
                    }
                });
        });
    }
}

// ------------------------------------------------------------------ grouping

/// Bucket every file by the folder it lives in, then order both levels by `sort`.
fn build_groups(
    snap: &Snapshot,
    sort: SortBy,
    cwds: &mut HashMap<PathBuf, Option<PathBuf>>,
) -> Vec<Group> {
    let mut at: HashMap<PathBuf, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();

    for rec in &snap.recent {
        let dir = rec
            .path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| rec.path.clone());
        let i = *at.entry(dir.clone()).or_insert_with(|| {
            groups.push(Group {
                label: String::new(),
                dir: dir.clone(),
                cwd: None,
                files: Vec::new(),
                mtime: UNIX_EPOCH,
            });
            groups.len() - 1
        });
        groups[i].mtime = groups[i].mtime.max(rec.mtime);
        groups[i].files.push(rec.clone());
    }

    // `snap.recent` is newest-first, so files[0] is the freshest session in the
    // folder — the cheapest one file to open for the folder's real cwd.
    for g in &mut groups {
        let newest = g.files.first().map(|r| r.path.clone());
        g.cwd = cwds
            .entry(g.dir.clone())
            .or_insert_with(|| newest.and_then(|p| meta::read(&p).cwd))
            .clone();
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

/// Claude gives one folder per project, so its cwd names the whole group.
/// Codex buckets by date, and one day mixes projects — so it stays a date.
fn group_label(g: &Group, roots: &[PathBuf]) -> String {
    let claude = roots
        .iter()
        .any(|r| root_tag(r) == "claude" && g.dir.starts_with(r));
    if claude {
        if let Some(name) = g.cwd.as_deref().and_then(leaf_name) {
            return name;
        }
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
        let Some(cwd) = g.cwd.as_deref() else { continue };
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
        let Ok(rest) = dir.strip_prefix(root) else { continue };
        let tag = root_tag(root);
        let rest = rest.to_string_lossy().replace('\\', "/");
        return if rest.is_empty() { tag.to_owned() } else { format!("{tag} {rest}") };
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
    format!("{}  {}", age(rec.mtime), title.unwrap_or_else(|| stem(&rec.name)))
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

    // The snapshot is already newest-first; only A-Z needs a per-frame reorder.
    let mut subdirs = node.subdirs.clone();
    let mut files = node.files.clone();
    if sort == SortBy::Name {
        subdirs.sort_by(|a, b| by_name(&leaf(a), &leaf(b)));
        files.sort_by(|a, b| by_name(&leaf(a), &leaf(b)));
    }

    for sub in &subdirs {
        draw_dir(
            ui, snap, sub, depth + 1, needle, sort, expanded, selected, titles, budget, pick,
        );
    }
    for f in &files {
        let Some(rec) = snap.by_path.get(f) else { continue };
        if !needle.is_empty() && !rec.path.to_string_lossy().to_lowercase().contains(needle) {
            continue;
        }
        let label = row_label(titles, budget, rec);
        ui.horizontal(|ui| {
            ui.add_space(indent + 12.0);
            let is_sel = selected.as_ref() == Some(f);
            if ui.selectable_label(is_sel, label).clicked() {
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

// --------------------------------------------------------------- preferences

fn prefs_path() -> PathBuf {
    index::home().join(".karin-rs.conf")
}

/// One tiny text file, so the window opens the way it was left. No serde.
fn load_prefs() -> (Theme, SortBy) {
    let (mut theme, mut sort) = (Theme::Dark, SortBy::Recent);
    let Ok(text) = std::fs::read_to_string(prefs_path()) else { return (theme, sort) };
    for line in text.lines() {
        match line.trim().split_once('=') {
            Some(("theme", "light")) => theme = Theme::Light,
            Some(("sort", "name")) => sort = SortBy::Name,
            _ => {}
        }
    }
    (theme, sort)
}

fn save_prefs(theme: Theme, sort: SortBy) {
    let text = format!(
        "theme={}\nsort={}\n",
        match theme {
            Theme::Light => "light",
            Theme::Dark => "dark",
        },
        match sort {
            SortBy::Name => "name",
            SortBy::Recent => "recent",
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
    egui::RichText::new(s).color(ui.visuals().weak_text_color()).small()
}

fn digits_for(n: usize) -> usize {
    n.max(1).to_string().len()
}

fn leaf(path: &Path) -> String {
    path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
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
