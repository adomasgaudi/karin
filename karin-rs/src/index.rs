//! The file index: seeded from the manifest, corrected by one background scan,
//! then kept live by OS change events. Nothing here polls. `notify` sits on
//! ReadDirectoryChangesW, so a write shows up in single-digit milliseconds.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime};

use notify::{EventKind, RecursiveMode, Watcher};

use crate::manifest;

#[derive(Clone)]
pub struct FileRec {
    pub path: PathBuf,
    pub name: String,
    pub mtime: SystemTime,
    pub size: u64,
}

/// Live state, shared with the UI thread behind one mutex.
#[derive(Default)]
pub struct Index {
    pub files: HashMap<PathBuf, FileRec>,
    pub roots: Vec<PathBuf>,
    /// Bumped on every mutation; the UI rebuilds its snapshot only when this moves.
    pub generation: u64,
    pub scanning: bool,
    pub last_event: Option<Instant>,
    pub last_changed: Option<PathBuf>,
    /// How long the last full walk took — the number the manifest exists to avoid.
    pub scan_ms: f32,
    /// Paths that moved since the UI last looked. The UI drains this and patches
    /// its snapshot; it only rebuilds from scratch when `rebuilt` is set.
    pub dirty: Vec<PathBuf>,
    pub rebuilt: bool,
    /// Paths the watcher touched since the current scan began. A scan started
    /// before those events must not resurrect what they removed.
    touched: HashSet<PathBuf>,
}

pub type Shared = Arc<Mutex<Index>>;

pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn default_roots() -> Vec<PathBuf> {
    let h = home();
    [
        h.join(".claude").join("projects"),
        h.join(".codex").join("sessions"),
    ]
    .into_iter()
    .filter(|p| p.is_dir())
    .collect()
}

/// Spawns the scan and the watcher. `cached` pre-populates the index so the
/// first frame is already full; `wake` is called whenever the index changes.
pub fn start(
    roots: Vec<PathBuf>,
    cached: &HashMap<PathBuf, manifest::Entry>,
    wake: impl Fn() + Send + Clone + 'static,
) -> Shared {
    let mut files = HashMap::new();
    for (path, entry) in cached {
        // A root the owner no longer has must not linger in the list.
        if !roots.iter().any(|r| path.starts_with(r)) {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        files.insert(
            path.clone(),
            FileRec {
                name: name.to_string_lossy().into_owned(),
                path: path.clone(),
                mtime: entry.mtime,
                size: entry.size,
            },
        );
    }

    let shared: Shared = Arc::new(Mutex::new(Index {
        files,
        roots: roots.clone(),
        scanning: true,
        rebuilt: true,
        ..Default::default()
    }));

    spawn_scan(&shared, roots.clone(), wake.clone());

    {
        let shared = shared.clone();
        thread::spawn(move || {
            let (tx, rx) = channel();
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(w) => w,
                Err(_) => return,
            };
            for root in &roots {
                let _ = watcher.watch(root, RecursiveMode::Recursive);
            }
            // The watcher must outlive the loop, so it stays owned right here.
            for event in rx {
                let Ok(event) = event else { continue };
                let mut touched = false;
                let mut ix = shared.lock().unwrap();
                for path in event.paths {
                    let changed = match event.kind {
                        EventKind::Remove(_) => ix.files.remove(&path).is_some(),
                        _ => match stat(&path) {
                            Some(rec) => {
                                ix.files.insert(rec.path.clone(), rec);
                                true
                            }
                            None => ix.files.remove(&path).is_some(),
                        },
                    };
                    if !changed {
                        continue;
                    }
                    ix.touched.insert(path.clone());
                    ix.dirty.push(path.clone());
                    ix.last_changed = Some(path);
                    touched = true;
                }
                if touched {
                    ix.generation += 1;
                    ix.last_event = Some(Instant::now());
                    drop(ix);
                    wake();
                }
            }
        });
    }

    shared
}

/// Re-walk the roots from scratch. The watcher keeps the index live on its own;
/// this is the answer when something changed while nobody was listening.
pub fn rescan(shared: &Shared, wake: impl Fn() + Send + Clone + 'static) {
    let roots = shared.lock().unwrap().roots.clone();
    spawn_scan(shared, roots, wake);
}

fn spawn_scan(shared: &Shared, roots: Vec<PathBuf>, wake: impl Fn() + Send + Clone + 'static) {
    {
        let mut ix = shared.lock().unwrap();
        ix.scanning = true;
        ix.touched.clear();
    }
    let shared = shared.clone();
    thread::spawn(move || {
        let t0 = Instant::now();
        let mut found = Vec::new();
        for root in &roots {
            scan_into(root, &mut found);
        }
        let elapsed = t0.elapsed().as_secs_f32() * 1000.0;

        let mut ix = shared.lock().unwrap();
        let seen: HashSet<PathBuf> = found.iter().map(|r| r.path.clone()).collect();

        // The watcher may have run ahead of this walk. Never replace a record
        // with an older reading of the same file, and never resurrect a path
        // the watcher has already reported gone.
        for rec in found {
            if ix.touched.contains(&rec.path) {
                continue;
            }
            match ix.files.get(&rec.path) {
                Some(old) if old.mtime > rec.mtime => continue,
                _ => {
                    ix.files.insert(rec.path.clone(), rec);
                }
            }
        }

        // Anything the manifest remembered but the disk no longer has.
        let gone: Vec<PathBuf> = ix
            .files
            .keys()
            .filter(|p| {
                !seen.contains(*p)
                    && !ix.touched.contains(*p)
                    && roots.iter().any(|r| p.starts_with(r))
            })
            .cloned()
            .collect();
        for path in gone {
            ix.files.remove(&path);
        }

        ix.scanning = false;
        ix.scan_ms = elapsed;
        ix.rebuilt = true;
        ix.dirty.clear();
        ix.generation += 1;
        drop(ix);
        wake();
    });
}

fn stat(path: &Path) -> Option<FileRec> {
    let md = fs::metadata(path).ok()?;
    if !md.is_file() {
        return None;
    }
    Some(FileRec {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_path_buf(),
        mtime: md.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        size: md.len(),
    })
}

fn scan_into(dir: &Path, out: &mut Vec<FileRec>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            scan_into(&entry.path(), out);
        } else if ft.is_file() {
            let path = entry.path();
            let (mtime, size) = entry
                .metadata()
                .map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()))
                .unwrap_or((SystemTime::UNIX_EPOCH, 0));
            out.push(FileRec {
                name: entry.file_name().to_string_lossy().into_owned(),
                path,
                mtime,
                size,
            });
        }
    }
}

// ---------------------------------------------------------------- snapshot

pub struct DirNode {
    pub subdirs: Vec<PathBuf>,
    pub files: Vec<PathBuf>,
    pub mtime: SystemTime,
    pub count: usize,
}

/// A frame-stable view of the index. Built once, then **patched** — a live
/// session appends a line a second, and re-sorting every file on every append
/// is the cost this type exists to avoid.
#[derive(Default)]
pub struct Snapshot {
    pub generation: u64,
    /// Newest first, always. Maintained by insertion, not by re-sorting.
    pub recent: Vec<FileRec>,
    pub dirs: HashMap<PathBuf, DirNode>,
    pub roots: Vec<PathBuf>,
    pub by_path: HashMap<PathBuf, FileRec>,
}

/// Bring `snap` up to date with `ix`, patching where possible.
///
/// Returns after clearing the index's change list, so every caller must be the
/// single UI consumer — which it is.
pub fn sync(snap: &mut Snapshot, ix: &mut Index) {
    if ix.rebuilt || snap.roots != ix.roots {
        *snap = build(ix);
        ix.rebuilt = false;
        ix.dirty.clear();
        return;
    }
    let dirty = std::mem::take(&mut ix.dirty);
    for path in dirty {
        apply(snap, ix.files.get(&path), &path);
    }
    snap.generation = ix.generation;
}

/// One changed path, folded into an already-correct snapshot.
fn apply(snap: &mut Snapshot, next: Option<&FileRec>, path: &Path) {
    let previous = snap.by_path.remove(path);
    if let Some(old) = &previous {
        if let Some(i) = position(&snap.recent, old.mtime, path) {
            snap.recent.remove(i);
        }
    }

    let Some(rec) = next else {
        // Removed. Counts drop along the chain; the rolled-up mtimes stay as
        // they were, which can leave a folder looking newer than its newest
        // remaining file until the next full scan. Cheap and self-healing.
        if previous.is_some() {
            if let Some(parent) = path.parent() {
                if let Some(node) = snap.dirs.get_mut(parent) {
                    node.files.retain(|f| f != path);
                }
                walk_up(snap, parent, |node| {
                    node.count = node.count.saturating_sub(1)
                });
            }
        }
        return;
    };

    snap.by_path.insert(rec.path.clone(), rec.clone());
    let at = snap.recent.partition_point(|r| r.mtime > rec.mtime);
    snap.recent.insert(at, rec.clone());

    let Some(parent) = path.parent() else { return };
    link(snap, parent);
    let is_new = previous.is_none();
    // One folder's worth of files gets re-ordered, not the whole index.
    let mut files = std::mem::take(&mut snap.dirs.get_mut(parent).expect("linked above").files);
    if is_new {
        files.push(path.to_path_buf());
    }
    files.sort_by_key(|p| {
        std::cmp::Reverse(
            snap.by_path
                .get(p)
                .map(|r| r.mtime)
                .unwrap_or(SystemTime::UNIX_EPOCH),
        )
    });
    snap.dirs.get_mut(parent).expect("linked above").files = files;

    let mtime = rec.mtime;
    walk_up(snap, parent, move |node| {
        node.mtime = node.mtime.max(mtime);
        if is_new {
            node.count += 1;
        }
    });
    resort_chain(snap, parent);
}

/// Locate a path in `recent`, which is sorted newest-first, given the mtime it
/// had when it was inserted. Files written in the same instant share a run, so
/// the binary search lands on the run and the scan finishes the job.
fn position(recent: &[FileRec], mtime: SystemTime, path: &Path) -> Option<usize> {
    let mut i = recent.partition_point(|r| r.mtime > mtime);
    while i < recent.len() && recent[i].mtime == mtime {
        if recent[i].path == path {
            return Some(i);
        }
        i += 1;
    }
    // A stale mtime means the linear fallback is the only correct answer.
    recent.iter().position(|r| r.path == path)
}

/// Make sure `dir` and every directory between it and a root exist and are linked.
fn link(snap: &mut Snapshot, dir: &Path) {
    let mut cur = dir.to_path_buf();
    loop {
        snap.dirs.entry(cur.clone()).or_insert_with(new_node);
        if snap.roots.contains(&cur) {
            return;
        }
        let Some(up) = cur.parent().map(Path::to_path_buf) else {
            return;
        };
        if up == cur {
            return;
        }
        let node = snap.dirs.entry(up.clone()).or_insert_with(new_node);
        if !node.subdirs.contains(&cur) {
            node.subdirs.push(cur.clone());
        }
        cur = up;
    }
}

/// Run `f` on `dir` and every ancestor up to and including its root.
fn walk_up(snap: &mut Snapshot, dir: &Path, mut f: impl FnMut(&mut DirNode)) {
    let mut cur = dir.to_path_buf();
    loop {
        if let Some(node) = snap.dirs.get_mut(&cur) {
            f(node);
        }
        if snap.roots.contains(&cur) {
            return;
        }
        let Some(up) = cur.parent().map(Path::to_path_buf) else {
            return;
        };
        if up == cur {
            return;
        }
        cur = up;
    }
}

/// A bumped folder mtime can overtake its siblings, so re-order the sibling
/// lists along this one chain. Every other branch of the tree is untouched.
fn resort_chain(snap: &mut Snapshot, dir: &Path) {
    let mut cur = dir.to_path_buf();
    while let Some(up) = cur.parent().map(Path::to_path_buf) {
        if up == cur || !snap.dirs.contains_key(&up) {
            return;
        }
        let mut subdirs = std::mem::take(&mut snap.dirs.get_mut(&up).unwrap().subdirs);
        subdirs.sort_by_key(|p| std::cmp::Reverse(dir_mtime(snap, p)));
        snap.dirs.get_mut(&up).unwrap().subdirs = subdirs;
        if snap.roots.contains(&up) {
            return;
        }
        cur = up;
    }
}

fn dir_mtime(snap: &Snapshot, dir: &Path) -> SystemTime {
    snap.dirs
        .get(dir)
        .map(|d| d.mtime)
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn new_node() -> DirNode {
    DirNode {
        subdirs: Vec::new(),
        files: Vec::new(),
        mtime: SystemTime::UNIX_EPOCH,
        count: 0,
    }
}

/// The full rebuild. Only runs when a scan finishes or the roots change.
fn build(ix: &Index) -> Snapshot {
    let mut snap = Snapshot {
        generation: ix.generation,
        by_path: ix.files.clone(),
        recent: Vec::new(),
        dirs: HashMap::new(),
        roots: ix.roots.clone(),
    };

    for root in &ix.roots {
        snap.dirs.entry(root.clone()).or_insert_with(new_node);
    }

    for rec in ix.files.values() {
        let Some(parent) = rec.path.parent() else {
            continue;
        };
        link(&mut snap, parent);
        snap.dirs
            .get_mut(parent)
            .expect("linked just above")
            .files
            .push(rec.path.clone());
    }

    // Roll mtime and counts up from the leaves: sort dirs deepest-first, then fold.
    let mut order: Vec<PathBuf> = snap.dirs.keys().cloned().collect();
    order.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for path in &order {
        let (mut mtime, mut count) = (SystemTime::UNIX_EPOCH, 0usize);
        {
            let d = &snap.dirs[path];
            for f in &d.files {
                if let Some(rec) = ix.files.get(f) {
                    mtime = mtime.max(rec.mtime);
                    count += 1;
                }
            }
            for s in &d.subdirs {
                if let Some(sd) = snap.dirs.get(s) {
                    mtime = mtime.max(sd.mtime);
                    count += sd.count;
                }
            }
        }
        let d = snap.dirs.get_mut(path).unwrap();
        d.mtime = mtime;
        d.count = count;
    }

    // Newest first, everywhere. That is the whole point of the view.
    let keys: Vec<PathBuf> = snap.dirs.keys().cloned().collect();
    for key in keys {
        let mut subdirs = std::mem::take(&mut snap.dirs.get_mut(&key).unwrap().subdirs);
        subdirs.sort_by_key(|p| std::cmp::Reverse(dir_mtime(&snap, p)));
        let mut files = std::mem::take(&mut snap.dirs.get_mut(&key).unwrap().files);
        files.sort_by_key(|p| {
            std::cmp::Reverse(
                ix.files
                    .get(p)
                    .map(|r| r.mtime)
                    .unwrap_or(SystemTime::UNIX_EPOCH),
            )
        });
        let d = snap.dirs.get_mut(&key).unwrap();
        d.subdirs = subdirs;
        d.files = files;
    }

    snap.recent = ix.files.values().cloned().collect();
    snap.recent.sort_by_key(|r| std::cmp::Reverse(r.mtime));
    snap
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn ix_with(files: &[(&str, u64)]) -> Index {
        let mut ix = Index {
            roots: vec![PathBuf::from("/r")],
            rebuilt: true,
            ..Default::default()
        };
        for (p, secs) in files {
            put(&mut ix, p, *secs);
        }
        ix
    }

    fn put(ix: &mut Index, p: &str, secs: u64) {
        let path = PathBuf::from(p);
        ix.files.insert(
            path.clone(),
            FileRec {
                name: path.file_name().unwrap().to_string_lossy().into_owned(),
                path: path.clone(),
                mtime: at(secs),
                size: secs,
            },
        );
        ix.dirty.push(path);
    }

    /// The two paths must agree on what the UI actually draws.
    fn same_lists(a: &Snapshot, b: &Snapshot) {
        let order = |s: &Snapshot| -> Vec<(PathBuf, SystemTime)> {
            s.recent.iter().map(|r| (r.path.clone(), r.mtime)).collect()
        };
        assert_eq!(order(a), order(b), "recent order");
        assert_eq!(a.by_path.len(), b.by_path.len(), "file count");

        let mut keys: Vec<_> = b.dirs.keys().cloned().collect();
        keys.sort();
        for k in keys {
            let (x, y) = (&a.dirs[&k], &b.dirs[&k]);
            assert_eq!(x.count, y.count, "count for {k:?}");
            assert_eq!(x.files, y.files, "files for {k:?}");
            assert_eq!(x.subdirs, y.subdirs, "subdirs for {k:?}");
        }
    }

    #[test]
    fn patching_matches_a_full_rebuild() {
        let mut ix = ix_with(&[("/r/a/1", 10), ("/r/a/2", 20), ("/r/b/1", 30)]);
        let mut snap = Snapshot::default();
        sync(&mut snap, &mut ix);

        // A live append to the oldest file, plus a brand-new session.
        put(&mut ix, "/r/a/1", 99);
        put(&mut ix, "/r/b/2", 50);
        ix.generation += 1;
        sync(&mut snap, &mut ix);

        let full = build(&ix);
        same_lists(&snap, &full);
        for (k, node) in &full.dirs {
            assert_eq!(snap.dirs[k].mtime, node.mtime, "mtime for {k:?}");
        }
    }

    #[test]
    fn deletion_keeps_counts_and_lists_correct() {
        let mut ix = ix_with(&[("/r/a/1", 10), ("/r/a/2", 20), ("/r/b/1", 30)]);
        let mut snap = Snapshot::default();
        sync(&mut snap, &mut ix);

        ix.files.remove(Path::new("/r/a/2"));
        ix.dirty.push(PathBuf::from("/r/a/2"));
        ix.generation += 1;
        sync(&mut snap, &mut ix);

        // Rolled-up mtimes are deliberately not walked back on delete, so only
        // the lists and counts are compared here.
        same_lists(&snap, &build(&ix));
        assert_eq!(snap.dirs[Path::new("/r")].count, 2);
    }

    #[test]
    fn a_stale_mtime_still_finds_its_row() {
        let recent = vec![
            FileRec {
                path: PathBuf::from("/r/x"),
                name: "x".into(),
                mtime: at(30),
                size: 0,
            },
            FileRec {
                path: PathBuf::from("/r/y"),
                name: "y".into(),
                mtime: at(20),
                size: 0,
            },
        ];
        assert_eq!(position(&recent, at(20), Path::new("/r/y")), Some(1));
        // Wrong mtime: the binary search misses and the fallback rescues it.
        assert_eq!(position(&recent, at(99), Path::new("/r/y")), Some(1));
        assert_eq!(position(&recent, at(20), Path::new("/r/zz")), None);
    }
}
