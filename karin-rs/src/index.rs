//! The file index: one full scan at startup, then OS-level change events patch it.
//! Nothing here polls. `notify` sits on ReadDirectoryChangesW, so a write shows up
//! in single-digit milliseconds.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime};

use notify::{EventKind, RecursiveMode, Watcher};

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

/// Spawns the scan and the watcher. `wake` is called whenever the index changes.
pub fn start(roots: Vec<PathBuf>, wake: impl Fn() + Send + Clone + 'static) -> Shared {
    let shared: Shared = Arc::new(Mutex::new(Index {
        roots: roots.clone(),
        scanning: true,
        ..Default::default()
    }));

    {
        let shared = shared.clone();
        let roots = roots.clone();
        let wake = wake.clone();
        thread::spawn(move || {
            let mut found = Vec::new();
            for root in &roots {
                scan_into(root, &mut found);
            }
            let mut ix = shared.lock().unwrap();
            for rec in found {
                ix.files.insert(rec.path.clone(), rec);
            }
            ix.scanning = false;
            ix.generation += 1;
            drop(ix);
            wake();
        });
    }

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
                    match event.kind {
                        EventKind::Remove(_) => {
                            if ix.files.remove(&path).is_some() {
                                ix.last_changed = Some(path);
                                touched = true;
                            }
                        }
                        _ => {
                            if let Some(rec) = stat(&path) {
                                ix.files.insert(rec.path.clone(), rec);
                                ix.last_changed = Some(path);
                                touched = true;
                            } else if ix.files.remove(&path).is_some() {
                                touched = true;
                            }
                        }
                    }
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
pub fn rescan(shared: &Shared, wake: impl Fn() + Send + 'static) {
    let roots = {
        let mut ix = shared.lock().unwrap();
        ix.scanning = true;
        ix.roots.clone()
    };
    let shared = shared.clone();
    thread::spawn(move || {
        let mut found = Vec::new();
        for root in &roots {
            scan_into(root, &mut found);
        }
        let mut ix = shared.lock().unwrap();
        ix.files.clear();
        for rec in found {
            ix.files.insert(rec.path.clone(), rec);
        }
        ix.scanning = false;
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

/// A frame-stable view of the index, rebuilt only when `generation` moves.
#[derive(Default)]
pub struct Snapshot {
    pub generation: u64,
    pub recent: Vec<FileRec>,
    pub dirs: HashMap<PathBuf, DirNode>,
    pub roots: Vec<PathBuf>,
    pub by_path: HashMap<PathBuf, FileRec>,
}

pub fn snapshot(ix: &Index) -> Snapshot {
    let mut dirs: HashMap<PathBuf, DirNode> = HashMap::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    let node = |dirs: &mut HashMap<PathBuf, DirNode>, p: &Path| {
        dirs.entry(p.to_path_buf()).or_insert_with(|| DirNode {
            subdirs: Vec::new(),
            files: Vec::new(),
            mtime: SystemTime::UNIX_EPOCH,
            count: 0,
        });
    };

    for root in &ix.roots {
        node(&mut dirs, root);
    }

    for rec in ix.files.values() {
        let Some(parent) = rec.path.parent() else {
            continue;
        };
        node(&mut dirs, parent);
        let d = dirs.get_mut(parent).unwrap();
        d.files.push(rec.path.clone());

        // Link the chain of parents up to (and including) a root.
        let mut cur = parent.to_path_buf();
        while !ix.roots.contains(&cur) {
            let Some(up) = cur.parent().map(Path::to_path_buf) else {
                break;
            };
            node(&mut dirs, &up);
            if seen.insert(cur.clone()) {
                dirs.get_mut(&up).unwrap().subdirs.push(cur.clone());
            }
            if up == cur {
                break;
            }
            cur = up;
        }
    }

    // Roll mtime and counts up from the leaves: sort dirs deepest-first, then fold.
    let mut order: Vec<PathBuf> = dirs.keys().cloned().collect();
    order.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for path in &order {
        let (mut mtime, mut count) = (SystemTime::UNIX_EPOCH, 0usize);
        {
            let d = &dirs[path];
            for f in &d.files {
                if let Some(rec) = ix.files.get(f) {
                    mtime = mtime.max(rec.mtime);
                    count += 1;
                }
            }
            for s in &d.subdirs {
                if let Some(sd) = dirs.get(s) {
                    mtime = mtime.max(sd.mtime);
                    count += sd.count;
                }
            }
        }
        let d = dirs.get_mut(path).unwrap();
        d.mtime = mtime;
        d.count = count;
    }

    // Newest first, everywhere. That is the whole point of the view.
    let mtime_of = |p: &PathBuf, dirs: &HashMap<PathBuf, DirNode>| -> SystemTime {
        dirs.get(p)
            .map(|d| d.mtime)
            .unwrap_or(SystemTime::UNIX_EPOCH)
    };
    let keys: Vec<PathBuf> = dirs.keys().cloned().collect();
    for key in keys {
        let mut subdirs = std::mem::take(&mut dirs.get_mut(&key).unwrap().subdirs);
        subdirs.sort_by_key(|p| std::cmp::Reverse(mtime_of(p, &dirs)));
        let mut files = std::mem::take(&mut dirs.get_mut(&key).unwrap().files);
        files.sort_by_key(|p| {
            std::cmp::Reverse(
                ix.files
                    .get(p)
                    .map(|r| r.mtime)
                    .unwrap_or(SystemTime::UNIX_EPOCH),
            )
        });
        let d = dirs.get_mut(&key).unwrap();
        d.subdirs = subdirs;
        d.files = files;
    }

    let mut recent: Vec<FileRec> = ix.files.values().cloned().collect();
    recent.sort_by_key(|r| std::cmp::Reverse(r.mtime));

    Snapshot {
        generation: ix.generation,
        by_path: ix.files.clone(),
        recent,
        dirs,
        roots: ix.roots.clone(),
    }
}
