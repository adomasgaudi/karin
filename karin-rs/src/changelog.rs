pub struct Entry {
    pub version: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub detail: Option<&'static str>,
}

/// Newest first. The app version is derived from this first entry.
pub const CHANGELOG: &[Entry] = &[
    Entry {
        version: "v.238",
        title: "Instant start, cheap updates",
        summary: "Remember the session list between runs and patch it instead of rebuilding it.",
        detail: Some(
            "A manifest at ~/.karin-rs.index caches every file's size, working directory, and opening prompt, so a launch shows the full list immediately rather than walking two trees and opening a thousand transcripts. A background walk then verifies it, never overwriting a newer reading from the watcher. Live appends now patch the snapshot in place — one file, one folder chain — instead of re-sorting everything.",
        ),
    },
    Entry {
        version: "v.237",
        title: "Correct project labels",
        summary: "Group sessions by working directory and use actual user prompts for titles.",
        detail: Some(
            "Codex transcripts are stored under date folders, but their session metadata contains the real project cwd. The project view now uses that cwd for grouping, while title extraction skips injected AGENTS context and reads the explicit user request.",
        ),
    },
    Entry {
        version: "v.236",
        title: "One-click Rust launcher",
        summary: "Launch the native viewer directly from a clickable repository file.",
        detail: Some(
            "karin-rs-launch.cmd resolves the repository-relative binary, builds it automatically when needed, and opens the native viewer. Double-click it from File Explorer whenever you want to start Karin without opening a terminal.",
        ),
    },
    Entry {
        version: "v.235",
        title: "Readable session records",
        summary: "Inspect JSONL sessions as collapsible records with raw JSON fallback.",
        detail: Some(
            "The readable pane previews user, assistant, tool, reasoning, and unknown records without hiding their original shape. Expand a row for a themed JSON tree, switch to raw JSON when exact structure matters, copy any record, or use the raw pane for literal line-by-line text.",
        ),
    },
    Entry {
        version: "v.234",
        title: "Light theme and projects",
        summary: "Switch themes, group sessions by project, and sort every view by name.",
        detail: Some(
            "The light palette derives secondary colors from egui's active visuals and persists alongside the sort choice. Project groups use the recorded working directory where available, while Codex date buckets remain dates.",
        ),
    },
];

pub const APP_VERSION: &str = CHANGELOG[0].version;
