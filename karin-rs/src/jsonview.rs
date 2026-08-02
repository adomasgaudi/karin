//! A readable rendering of arbitrary JSON — no braces, no quotes, no commas.
//!
//! Ported from karin's `JsonView.tsx`. Structure is carried by nesting and a
//! collapsing header; a key sits in its own muted column and its value reads as
//! plain text beside it. The point is inspection, not fidelity — the raw line
//! stays one click away for when the exact bytes matter.

use std::borrow::Cow;

use egui::collapsing_header::CollapsingState;
use egui::{Color32, RichText};
use serde_json::{Map, Value};

/// Past this a string stops being a value on a line and becomes its own block.
const BLOCK_AT: usize = 90;
/// One 40 KB tool result must not bury the rest of the record.
const CLAMP_AT: usize = 1200;
const KEY_W: f32 = 118.0;
const FONT: f32 = 11.5;

pub struct View<'a> {
    /// The session's working directory: paths inside it drop the part the owner
    /// already knows. `None` shortens nothing.
    pub root: Option<&'a str>,
    /// Set for the single frame an "expand all" / "collapse all" is pressed.
    /// egui stores the state it is given, so one frame is enough to move every
    /// branch at once and hand control straight back to the mouse.
    pub force: Option<bool>,
}

impl View<'_> {
    pub fn show(&self, ui: &mut egui::Ui, value: &Value, hide: &[&str]) {
        match value {
            Value::Object(map) => {
                for (k, v) in map.iter().filter(|(k, _)| !hide.contains(&k.as_str())) {
                    self.node(ui, k, v, 0);
                }
            }
            Value::Array(items) => self.array(ui, items, 0),
            scalar => self.scalar(ui, "", scalar),
        }
    }

    /// One key → value line. Branches nest, scalars sit on the line, long
    /// strings drop to a block underneath the key.
    fn node(&self, ui: &mut egui::Ui, key: &str, raw: &Value, depth: usize) {
        // A lot of payload arrives as JSON stuffed inside a string — hook stdout,
        // tool arguments. Unwrap it so it becomes a normal branch.
        let embedded = embedded_json(raw);
        let v = embedded.as_ref().unwrap_or(raw);
        let label = readable_key(key);

        match v {
            Value::Array(items) if items.is_empty() => self.empty(ui, &label, "empty"),
            Value::Object(map) if map.is_empty() => self.empty(ui, &label, "empty"),

            // `["a","b"]` reads as a bullet list; numeric index keys would be noise.
            Value::Array(items) if items.iter().all(is_plain) => {
                self.branch(
                    ui,
                    &label,
                    &count(v),
                    embedded.is_some(),
                    depth,
                    items.len(),
                    |me, ui| {
                        for item in items {
                            ui.horizontal_wrapped(|ui| {
                                ui.label(dim(ui, "·"));
                                me.scalar(ui, key, item);
                            });
                        }
                    },
                );
            }
            Value::Array(items) => {
                self.branch(
                    ui,
                    &label,
                    &count(v),
                    embedded.is_some(),
                    depth,
                    items.len(),
                    |me, ui| me.array(ui, items, depth + 1),
                );
            }
            Value::Object(map) => {
                self.branch(
                    ui,
                    &label,
                    &count(v),
                    embedded.is_some(),
                    depth,
                    map.len(),
                    |me, ui| me.object(ui, map, depth + 1),
                );
            }
            Value::String(s) if s.contains('\n') || s.chars().count() > BLOCK_AT => {
                ui.label(dim(ui, &label));
                self.text_block(ui, s);
            }
            scalar => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing.x = 8.0;
                    key_cell(ui, &label);
                    self.scalar(ui, key, scalar);
                });
            }
        }
    }

    fn object(&self, ui: &mut egui::Ui, map: &Map<String, Value>, depth: usize) {
        for (k, v) in map {
            self.node(ui, k, v, depth);
        }
    }

    fn array(&self, ui: &mut egui::Ui, items: &[Value], depth: usize) {
        for (i, item) in items.iter().enumerate() {
            self.node(ui, &item_label(item, i), item, depth);
        }
    }

    fn empty(&self, ui: &mut egui::Ui, label: &str, what: &str) {
        ui.horizontal_wrapped(|ui| {
            key_cell(ui, label);
            ui.label(dim(ui, what));
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn branch(
        &self,
        ui: &mut egui::Ui,
        label: &str,
        count: &str,
        from_string: bool,
        depth: usize,
        children: usize,
        body: impl FnOnce(&Self, &mut egui::Ui),
    ) {
        // Shallow, small branches open themselves; deep or wide ones wait to be asked.
        let open = depth < 2 && children <= 12;
        let id = ui.make_persistent_id((label.to_owned(), depth, children));
        let mut state = CollapsingState::load_with_default_open(ui.ctx(), id, open);
        if let Some(force) = self.force {
            state.set_open(force);
        }

        // No triangle. A branch key is simply darker and heavier than a leaf's,
        // which is enough of a difference to read as "there is more in here" —
        // and it keeps every key on the same left edge.
        let header = ui
            .horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                let head = RichText::new(label)
                    .size(FONT)
                    .strong()
                    .color(ui.visuals().text_color());
                let resp = ui.add_sized(
                    [KEY_W, ui.spacing().interact_size.y * 0.7],
                    egui::SelectableLabel::new(false, head),
                );
                let tag = if from_string { "  json" } else { "" };
                ui.label(dim(ui, &format!("{count}{tag}")));
                resp
            })
            .inner;

        if header.clicked() {
            state.toggle(ui);
        }
        state.show_body_indented(&header, ui, |ui| body(self, ui));
    }

    fn scalar(&self, ui: &mut egui::Ui, key: &str, v: &Value) {
        let dark = ui.visuals().dark_mode;
        match v {
            Value::Null => {
                ui.label(dim(ui, "—"));
            }
            // true/false stay true/false: a boolean is already plain English, and
            // rewriting it as yes/no quietly changes what the record said.
            Value::Bool(b) => {
                let c = if *b {
                    if dark {
                        Color32::from_rgb(110, 215, 160)
                    } else {
                        Color32::from_rgb(20, 130, 90)
                    }
                } else {
                    ui.visuals().weak_text_color()
                };
                ui.label(RichText::new(b.to_string()).monospace().size(FONT).color(c));
            }
            Value::Number(n) => {
                let c = if dark {
                    Color32::from_rgb(125, 200, 240)
                } else {
                    Color32::from_rgb(20, 100, 160)
                };
                ui.label(
                    RichText::new(group_digits(n))
                        .monospace()
                        .size(FONT)
                        .color(c),
                );
            }
            Value::String(s) => {
                let clean = strip_ansi(s);
                if clean.trim().is_empty() {
                    ui.label(dim(ui, "(empty)"));
                    return;
                }
                let shown = self.shorten(&clean);
                let text = RichText::new(shown.as_ref())
                    .monospace()
                    .size(FONT)
                    .color(ui.visuals().text_color());
                let resp = ui.label(text);
                if shown != clean {
                    resp.on_hover_text(clean.as_ref());
                }
                if let Some(hint) = clock_hint(key, &clean) {
                    ui.label(dim(ui, &hint));
                }
            }
            other => {
                ui.label(RichText::new(other.to_string()).monospace().size(FONT));
            }
        }
    }

    /// A long or multi-line string, clamped with a way to see the rest.
    fn text_block(&self, ui: &mut egui::Ui, text: &str) {
        let clean = strip_ansi(text);
        let long = clean.chars().count() > CLAMP_AT;
        let id = ui
            .id()
            .with(("block", clean.len(), &clean[..clean.len().min(24)]));
        let mut full = ui.data_mut(|d| d.get_temp::<bool>(id).unwrap_or(false));

        let shown: String = if long && !full {
            clean.chars().take(CLAMP_AT).collect::<String>() + "…"
        } else {
            clean.to_string()
        };
        ui.indent(id, |ui| {
            ui.label(RichText::new(shown).monospace().size(FONT));
            if long {
                let label = if full {
                    "show less".to_owned()
                } else {
                    format!("show all {} chars", clean.chars().count())
                };
                if ui.link(dim(ui, &label)).clicked() {
                    full = !full;
                    ui.data_mut(|d| d.insert_temp(id, full));
                }
            }
        });
    }

    /// Drop the project prefix from a path inside the project; anything outside
    /// keeps every segment, because there the location is the point.
    fn shorten<'v>(&self, value: &'v str) -> Cow<'v, str> {
        let Some(root) = self.root else {
            return Cow::Borrowed(value);
        };
        if value.len() < 3 || !value.contains(['/', '\\']) {
            return Cow::Borrowed(value);
        }
        let root = root.replace('\\', "/");
        let root = root.trim_end_matches('/');
        if root.is_empty() {
            return Cow::Borrowed(value);
        }
        let flat = value.replace('\\', "/");
        if !flat
            .to_lowercase()
            .starts_with(&format!("{}/", root.to_lowercase()))
        {
            return Cow::Borrowed(value);
        }
        let rest = flat[root.len() + 1..].to_owned();
        if rest.is_empty() {
            Cow::Borrowed(value)
        } else {
            Cow::Owned(rest)
        }
    }
}

// -------------------------------------------------------------------- bits

/// The key column: fixed width so values line up, and **left**-aligned so the
/// keys themselves do too. `add_sized` centres, which left a ragged edge that
/// was harder to read down than the values it was meant to organise.
fn key_cell(ui: &mut egui::Ui, label: &str) {
    let h = ui.spacing().interact_size.y * 0.7;
    ui.allocate_ui_with_layout(
        egui::vec2(KEY_W, h),
        egui::Layout::left_to_right(egui::Align::Center),
        |ui| {
            ui.add(egui::Label::new(dim(ui, label)).truncate());
        },
    );
}

fn dim(ui: &egui::Ui, s: &str) -> RichText {
    RichText::new(s)
        .size(FONT - 0.5)
        .color(ui.visuals().weak_text_color())
}

fn is_plain(v: &Value) -> bool {
    match v {
        Value::Object(_) | Value::Array(_) => false,
        Value::String(s) => s.chars().count() <= BLOCK_AT,
        _ => true,
    }
}

fn count(v: &Value) -> String {
    let (n, word) = match v {
        Value::Array(a) => (a.len(), "item"),
        Value::Object(o) => (o.len(), "field"),
        _ => return String::new(),
    };
    if n == 1 {
        format!("1 {word}")
    } else {
        format!("{n} {word}s")
    }
}

/// Index keys tell you nothing, so an item borrows its own identifying field.
const ID_KEYS: [&str; 7] = ["name", "type", "kind", "label", "tool", "role", "id"];

fn item_label(item: &Value, i: usize) -> String {
    if item.is_object() {
        for key in ID_KEYS {
            if let Some(v) = item
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
            {
                return format!("{i}. {}", crate::meta::truncate(v, 32));
            }
        }
    }
    format!("{i}.")
}

fn readable_key(key: &str) -> String {
    match key {
        "cwd" => return "working directory".into(),
        "file_path" => return "file".into(),
        "old_string" => return "find".into(),
        "new_string" => return "replace with".into(),
        "subagent_type" => return "agent type".into(),
        "run_in_background" => return "background".into(),
        _ => {}
    }
    // `0. tool_use` keeps its index prefix; only the body is humanised.
    let (prefix, body) = match key.split_once(". ") {
        Some((i, rest)) if i.chars().all(|c| c.is_ascii_digit()) => (format!("{i}. "), rest),
        _ => (String::new(), key),
    };

    let mut out = String::with_capacity(body.len() + 4);
    let mut prev_lower = false;
    for c in body.chars() {
        if c == '_' || c == '-' {
            out.push(' ');
            prev_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        out.push(c);
    }
    let mut chars = out.trim().chars();
    let cased = match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    };
    prefix + &cased
}

/// `2026-08-02T08:46:49.132Z` → `08-02 08:46:49` beside the raw value.
fn clock_hint(key: &str, v: &str) -> Option<String> {
    let k = key.to_lowercase();
    if !(k == "timestamp" || k.ends_with("_at") || k.ends_with("_time") || k == "time") {
        return None;
    }
    let (date, rest) = v.split_once('T')?;
    let time = rest.split(['.', 'Z', '+']).next()?;
    let day = date.get(5..)?;
    (time.len() == 8).then(|| format!("{day} {time}"))
}

/// Numbers read better grouped: `1234567` → `1 234 567`.
fn group_digits(n: &serde_json::Number) -> String {
    let s = n.to_string();
    let (int, frac) = s.split_once('.').map_or((s.as_str(), ""), |(a, b)| (a, b));
    let (sign, digits) = int.strip_prefix('-').map_or(("", int), |d| ("-", d));
    if digits.len() <= 4 {
        return s;
    }
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(' ');
        }
        out.push(c);
    }
    let frac = if frac.is_empty() {
        String::new()
    } else {
        format!(".{frac}")
    };
    format!("{sign}{out}{frac}")
}

/// A string that is itself JSON becomes a real branch instead of a wall of
/// escaped braces. Only objects and arrays qualify.
fn embedded_json(v: &Value) -> Option<Value> {
    let s = v.as_str()?.trim();
    let (first, last) = (s.chars().next()?, s.chars().last()?);
    if !((first == '{' && last == '}') || (first == '[' && last == ']')) {
        return None;
    }
    let parsed = serde_json::from_str::<Value>(s).ok()?;
    (parsed.is_object() || parsed.is_array()).then_some(parsed)
}

/// Terminal tools return ANSI colour and cursor sequences; useful in a terminal,
/// visible control-code noise in a transcript.
pub fn strip_ansi(s: &str) -> Cow<'_, str> {
    if !s.contains('\u{1b}') {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            // CSI: parameters, then one final byte.
            Some('[') => {
                for n in chars.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            // OSC: runs until BEL or another escape.
            Some(']') => {
                for n in chars.by_ref() {
                    if n == '\u{7}' || n == '\u{1b}' {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    Cow::Owned(out)
}
