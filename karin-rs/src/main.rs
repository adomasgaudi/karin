#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod changelog;
mod index;
mod jsonview;
mod logo;
mod manifest;
mod meta;
mod records;

/// Owner-facing version, derived from the newest Rust changelog entry.
pub const APP_VERSION: &str = changelog::APP_VERSION;

fn main() -> eframe::Result<()> {
    if std::env::args().any(|a| a == "--bench") {
        bench();
        return Ok(());
    }

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([640.0, 400.0])
            .with_title("karin-rs"),
        vsync: false, // never wait a frame we don't have to
        ..Default::default()
    };

    eframe::run_native(
        "karin-rs",
        options,
        Box::new(|cc| Ok(Box::new(app::App::new(cc)))),
    )
}

/// `karin-rs --bench` — what the manifest costs and what it saves, on this
/// machine's real session folders. Console only; the window never opens.
fn bench() {
    use std::time::Instant;

    let roots = index::default_roots();

    let t = Instant::now();
    let cached = manifest::load();
    println!("manifest load   {:>8.1} ms  ({} rows)", ms(t), cached.len());

    let t = Instant::now();
    let files = walk(&roots);
    println!("directory walk  {:>8.1} ms  ({} files)", ms(t), files.len());

    let t = Instant::now();
    let mut titled = 0;
    for path in &files {
        if meta::read(path).cwd.is_some() {
            titled += 1;
        }
    }
    println!(
        "read every head {:>8.1} ms  ({titled} with a cwd) — what the manifest replaces",
        ms(t)
    );
}

fn ms(t: std::time::Instant) -> f32 {
    t.elapsed().as_secs_f32() * 1000.0
}

fn walk(roots: &[std::path::PathBuf]) -> Vec<std::path::PathBuf> {
    fn go(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            match e.file_type() {
                Ok(ft) if ft.is_dir() => go(&e.path(), out),
                Ok(ft) if ft.is_file() => out.push(e.path()),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    for root in roots {
        go(root, &mut out);
    }
    out
}
