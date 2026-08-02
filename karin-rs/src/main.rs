#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod index;

fn main() -> eframe::Result<()> {
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
