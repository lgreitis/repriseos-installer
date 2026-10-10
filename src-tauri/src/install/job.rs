use super::{InstallState, Result};
use reprise_bundle::assembly::Artifacts;
use reprise_device::NorDump;
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
pub struct InstallEvent {
    stage: String,
    detail: String,
    completed: Option<u64>,
    total: Option<u64>,
    cancellable: bool,
    diagnostic: bool,
}

#[derive(Serialize)]
pub struct InstallResult {
    backup_path: String,
}

pub(super) struct Job<'a> {
    pub(super) directory: PathBuf,
    device_directory: PathBuf,
    state: &'a InstallState,
    channel: Channel<InstallEvent>,
    journal: File,
    stage: String,
    log_error: Option<String>,
    cancellable: bool,
}

impl<'a> Job<'a> {
    pub(super) fn new(
        state: &'a InstallState,
        channel: Channel<InstallEvent>,
        directory: PathBuf,
    ) -> Result<Self> {
        let device_directory = directory
            .parent()
            .ok_or("Missing device backup directory")?
            .to_owned();
        let journal = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("events.jsonl"))?;
        Ok(Self {
            directory,
            device_directory,
            state,
            channel,
            journal,
            stage: "prepare".into(),
            log_error: None,
            cancellable: true,
        })
    }

    pub(super) fn emit(&mut self, detail: impl Into<String>, progress: Option<(u64, u64)>) {
        self.emit_event(detail.into(), progress, false);
    }

    pub(super) fn log(&mut self, detail: impl Into<String>) {
        self.emit_event(detail.into(), None, true);
    }

    fn emit_event(&mut self, detail: String, progress: Option<(u64, u64)>, diagnostic: bool) {
        let event = InstallEvent {
            stage: self.stage.clone(),
            detail,
            completed: progress.map(|p| p.0),
            total: progress.map(|p| p.1),
            cancellable: self.cancellable,
            diagnostic,
        };
        let saved = serde_json::to_writer(&mut self.journal, &event)
            .map_err(std::io::Error::other)
            .and_then(|()| self.journal.write_all(b"\n"));
        if let Err(error) = saved {
            self.log_error = Some(error.to_string());
        }
        let _ = self.channel.send(event);
    }

    fn check(&self) -> Result<()> {
        if let Some(error) = &self.log_error {
            return Err(error.clone().into());
        }
        if self
            .state
            .cancellation
            .lock()
            .map_err(|e| e.to_string())?
            .requested
        {
            return Err("Installation cancelled.".into());
        }
        Ok(())
    }

    pub(super) fn stage(&mut self, stage: &str, detail: &str) -> Result<()> {
        self.check()?;
        self.stage = stage.into();
        self.emit(detail, None);
        self.journal.sync_all()?;
        self.check()
    }

    pub(super) fn progress(
        &mut self,
        detail: &str,
        completed: usize,
        total: usize,
    ) -> reprise_device::Result<()> {
        self.emit(detail, Some((completed as u64, total as u64)));
        self.check()
            .map_err(|e| reprise_device::Error::Invalid(e.to_string()))
    }

    pub(super) fn save_json(&self, name: &str, value: &impl Serialize) -> Result<()> {
        save_json(&self.directory.join(name), value)
    }

    pub(super) fn save_nor(&self, nor: &NorDump, syscfg_size: usize) -> Result<()> {
        let snapshot = self.device_directory.join("nor").join(&nor.report.sha256);
        fs::create_dir_all(&snapshot)?;
        save_or_verify(&snapshot.join("nor.bin"), &nor.bytes)?;
        save_or_verify(&snapshot.join("syscfg.bin"), &nor.bytes[..syscfg_size])?;
        self.save_json(
            "nor.json",
            &serde_json::json!({
                "backup": format!("../nor/{}/nor.bin", nor.report.sha256),
                "report": nor.report,
            }),
        )
    }

    pub(super) fn save_firmware(&self, artifacts: &Artifacts) -> Result<()> {
        let staged = self.directory.join("firmware");
        let report = artifacts.write(&staged)?;
        let latest = self.device_directory.join("firmware");
        match fs::remove_dir_all(&latest) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        fs::rename(staged, latest)?;
        self.save_json("assembly.json", &report)
    }

    pub(super) fn begin_bootloader(&mut self) -> Result<()> {
        self.stage("bootloader", "Preparing bootloader installer")?;
        {
            let mut cancellation = self.state.cancellation.lock().map_err(|e| e.to_string())?;
            if cancellation.requested {
                return Err("Installation cancelled.".into());
            }
            cancellation.allowed = false;
        }
        self.cancellable = false;
        self.emit("Preparing bootloader installer", None);
        self.journal.sync_all()?;
        self.check()
    }

    pub(super) fn finish(mut self, outcome: Result<()>) -> Result<InstallResult> {
        match outcome {
            Ok(()) => {
                save_json(
                    &self.directory.join("result.json"),
                    &serde_json::json!({"state": "installer_sent"}),
                )?;
                self.journal.sync_all()?;
                Ok(InstallResult {
                    backup_path: self.directory.to_string_lossy().into_owned(),
                })
            }
            Err(error) => {
                let detail = format!(
                    "{error} Backups and logs: {}. Re-enter DFU before retrying.",
                    self.directory.display()
                );
                self.emit(&detail, None);
                let _ = self.journal.sync_all();
                let _ = save_json(
                    &self.directory.join("result.json"),
                    &serde_json::json!({"state": "failed", "stage": self.stage, "detail": detail}),
                );
                Err(detail.into())
            }
        }
    }
}

pub(super) fn backup_directory(data: &Path, hardware_id: &[u8]) -> Result<PathBuf> {
    let device_key: String = hardware_id.iter().map(|b| format!("{b:02x}")).collect();
    let backups = data.join("backups").join(device_key);
    fs::create_dir_all(&backups)?;
    let directory = backups.join(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_nanos()
            .to_string(),
    );
    fs::create_dir(&directory)?;
    Ok(directory)
}

pub(super) fn save(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if fs::read(path)? != bytes {
        return Err("Saved file readback differs from its source.".into());
    }
    Ok(())
}

fn save_or_verify(path: &Path, bytes: &[u8]) -> Result<()> {
    match fs::read(path) {
        Ok(saved) if saved == bytes => Ok(()),
        Ok(_) => Err(format!(
            "Existing backup does not match the verified device data: {}",
            path.display()
        )
        .into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => save(path, bytes),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn save_json(path: &Path, value: &impl Serialize) -> Result<()> {
    save(path, &serde_json::to_vec_pretty(value)?)
}

#[cfg(test)]
mod tests;
