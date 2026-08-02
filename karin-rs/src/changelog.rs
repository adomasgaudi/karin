pub struct Entry {
    pub version: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub detail: Option<&'static str>,
}

/// Newest first. The app version is derived from this first entry.
pub const CHANGELOG: &[Entry] = &[
    Entry {
        version: "v.240",
        title: "An icon, and no terminal",
        summary: "Karin's glasses as the app icon, and the shortcut opens the window directly.",
        detail: Some(
            "The Desktop shortcut ran a .cmd that started a debug build, and a debug build keeps its console — so a terminal appeared first every time. It now points straight at the release binary, which has no console at all. The red glasses mark is drawn in code and rasterised for the window, the taskbar, and the .ico, so the three can never disagree; below 32px the strokes widen and the frame arms drop rather than smearing. The clean/structured/raw switch moved to the left of the file header, where a very wide window can no longer push it off the edge.",
        ),
    },
    Entry {
        version: "v.239",
        title: "Three ways to read a session",
        summary: "Clean, structured, and raw views, with a source mark on every session.",
        detail: Some(
            "Clean shows the conversation only: prompts, replies, and one quiet line per tool. Structured keeps every record but accents it by what it actually is and greys the harness's bookkeeping. Raw is unchanged. Both harnesses replay tool output under the user's name and inject context there too, so a record is now classified by what it is rather than by its type field. Each session row carries its agent's mark, and Ctrl+B hides the list so a narrow window can give the whole width to the transcript.",
        ),
    },
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
