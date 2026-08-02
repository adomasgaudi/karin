pub struct Entry {
    pub version: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub detail: Option<&'static str>,
}

/// Newest first. The app version is derived from this first entry.
pub const CHANGELOG: &[Entry] = &[
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
