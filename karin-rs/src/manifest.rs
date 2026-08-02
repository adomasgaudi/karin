//! What the last run already knew, written to one file so the next run starts
//! populated instead of walking two directory trees and opening a thousand
//! transcripts. It is a cache and never the truth: delete it and the app is
//! merely slow to its first frame, not wrong.
//!
//! Format is one tab-separated row per file, no serde:
//!
//! ```text
//! path \t mtime_ns \t size \t cwd \t title
//! ```
//!
//! The two text columns carry a third state beyond "value" and "empty" — the
//! file may simply never have been opened. `?` means unread; `=` prefixes a
//! read value, so `=` alone is "read it, found nothing" and a title of `-` or
//! `?` survives the round trip.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Bumping this invalidates every cached row, which is the point: a format
/// change should reread rather than misparse.
const HEADER: &str = "karin-rs-index\t1";

const UNREAD: &str = "?";

/// One remembered file. `None` on a text field means nobody has looked yet;
/// `Some(None)` means someone looked and the transcript had nothing to say.
#[derive(Clone)]
pub struct Entry {
    pub mtime: SystemTime,
    pub size: u64,
    pub cwd: Option<Option<PathBuf>>,
    pub title: Option<Option<String>>,
}

pub fn path() -> PathBuf {
    crate::index::home().join(".karin-rs.index")
}

pub fn load() -> HashMap<PathBuf, Entry> {
    let mut out = HashMap::new();
    let Ok(text) = std::fs::read_to_string(path()) else {
        return out;
    };
    let mut lines = text.lines();
    if lines.next() != Some(HEADER) {
        return out;
    }
    for line in lines {
        let mut col = line.split('\t');
        let (Some(p), Some(mt), Some(size), Some(cwd), Some(title)) =
            (col.next(), col.next(), col.next(), col.next(), col.next())
        else {
            continue;
        };
        let (Ok(mtime_ns), Ok(size)) = (mt.parse::<u64>(), size.parse::<u64>()) else {
            continue;
        };
        out.insert(
            PathBuf::from(p),
            Entry {
                mtime: UNIX_EPOCH + Duration::from_nanos(mtime_ns),
                size,
                cwd: decode(cwd).map(|v| v.map(PathBuf::from)),
                title: decode(title),
            },
        );
    }
    out
}

/// Written to a sibling temp file and renamed, so a crash mid-write leaves the
/// previous cache intact rather than a half-row that parses into nonsense.
pub fn save(rows: impl Iterator<Item = (PathBuf, Entry)>) {
    let mut out = String::from(HEADER);
    out.push('\n');
    for (file, entry) in rows {
        let file = file.to_string_lossy();
        if file.contains('\t') || file.contains('\n') {
            continue;
        }
        let cwd = entry
            .cwd
            .map(|v| v.map(|p| p.to_string_lossy().into_owned()));
        out.push_str(&format!(
            "{file}\t{}\t{}\t{}\t{}\n",
            nanos(entry.mtime),
            entry.size,
            encode(cwd.as_ref().map(|v| v.as_deref())),
            encode(entry.title.as_ref().map(|v| v.as_deref())),
        ));
    }

    let final_path = path();
    let temp = final_path.with_extension("index.tmp");
    if std::fs::write(&temp, out).is_ok() && std::fs::rename(&temp, &final_path).is_err() {
        let _ = std::fs::remove_file(&temp);
    }
}

fn nanos(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

fn encode(v: Option<Option<&str>>) -> String {
    match v {
        None => UNREAD.to_owned(),
        Some(inner) => format!("={}", sanitize(inner.unwrap_or_default())),
    }
}

fn decode(s: &str) -> Option<Option<String>> {
    let rest = s.strip_prefix('=')?;
    Some((!rest.is_empty()).then(|| rest.to_owned()))
}

/// Titles are display strings, so flattening a stray tab costs nothing and
/// keeps every row exactly five columns wide.
fn sanitize(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ")
}
