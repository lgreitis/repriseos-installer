use super::{InstallState, Result};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path, sync::atomic::Ordering};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const REPORTS: &[&str] = &[
    "device.json",
    "hardware-override.json",
    "inputs.json",
    "plan.json",
    "bootloader.json",
    "storage.json",
    "nor.json",
    "assembly.json",
    "uploadLoader.json",
    "uploadOsos.json",
    "uploadDefaultTheme.json",
    "uploadDarkTheme.json",
    "result.json",
];
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

type Entry = (String, Vec<u8>);

#[tauri::command]
pub async fn save_debug_zip(
    app: AppHandle,
    session_log: String,
    preview: bool,
) -> std::result::Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || export(&app, &session_log, preview))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn export(app: &AppHandle, session_log: &str, preview: bool) -> Result<Option<String>> {
    if preview && !cfg!(debug_assertions) {
        return Err("Debug ZIP preview requires a development build.".into());
    }
    let state = app.state::<InstallState>();
    if state.running.load(Ordering::Acquire) {
        return Err("Wait for installation cleanup to finish.".into());
    }
    // Preview exports must never read a real installation's diagnostics.
    let directory = if preview {
        None
    } else {
        state
            .failed_directory
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
    };
    let entries = collect(directory.as_deref(), session_log, preview)?;
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Save debug ZIP")
        .set_file_name("repriseos-debug.zip")
        .add_filter("ZIP archive", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = file.into_path()?;
    if path.extension().is_none() {
        path.set_extension("zip");
    }
    write_archive(&path, &entries)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn collect(directory: Option<&Path>, session_log: &str, preview: bool) -> Result<Vec<Entry>> {
    if session_log.len() as u64 > MAX_FILE_BYTES {
        return Err("Session log exceeds 8 MiB.".into());
    }
    let mut entries = vec![
        ("session.txt".into(), redact(session_log).into_bytes()),
        (
            "environment.json".into(),
            serde_json::to_vec_pretty(&json!({
                "installer_version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "simulated": preview,
            }))?,
        ),
    ];
    if preview {
        entries.push((
            "result.json".into(),
            serde_json::to_vec_pretty(&json!({
                "state": "failed", "stage": "storage", "simulated": true,
                "detail": "Invalid FAT32 sector size (code -301)",
            }))?,
        ));
        entries.push(("events.jsonl".into(), b"{\"stage\":\"storage\",\"detail\":\"Simulated read: LBA=394224; rc=0; repeat rc=0; match=yes; all zero=true\"}\n".to_vec()));
        entries.push(("storage-00-p1-x8-lba394224-read1.bin".into(), vec![0; 512]));
        entries.push(("storage-00-p1-x8-lba394224-read2.bin".into(), vec![0; 512]));
    } else if let Some(directory) = directory {
        let mut notes = Vec::new();
        for name in REPORTS.iter().copied().chain(["events.jsonl"]) {
            match read_report(&directory.join(name), name) {
                Ok(Some(content)) => entries.push((name.into(), content)),
                Ok(None) => {}
                Err(error) => notes.push(format!("Skipped {name}: {error}")),
            }
        }
        let mut sectors = Vec::new();
        match fs::read_dir(directory) {
            Ok(files) => {
                for file in files {
                    let entry = match file {
                        Ok(entry) => entry,
                        Err(error) => {
                            notes.push(format!("Could not read directory entry: {error}"));
                            continue;
                        }
                    };
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !sector_name(&name) {
                        continue;
                    }
                    let read = || -> Result<Option<Vec<u8>>> {
                        if !entry.file_type()?.is_file() {
                            return Ok(None);
                        }
                        if entry.metadata()?.len() != 512 {
                            return Err("Expected a 512-byte sector dump".into());
                        }
                        let bytes = fs::read(entry.path())?;
                        if bytes.len() != 512 {
                            return Err("Incomplete sector dump".into());
                        }
                        Ok(Some(bytes))
                    };
                    match read() {
                        Ok(Some(bytes)) => sectors.push((name, bytes)),
                        Ok(None) => {}
                        Err(error) => notes.push(format!("Skipped {name}: {error}")),
                    }
                }
            }
            Err(error) => notes.push(format!("Could not list sector dumps: {error}")),
        }
        sectors.sort_by(|a, b| a.0.cmp(&b.0));
        entries.extend(sectors);
        if !notes.is_empty() {
            entries.push((
                "export-notes.txt".into(),
                redact(&notes.join("\n")).into_bytes(),
            ));
        }
    }
    Ok(entries)
}

fn read_report(path: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("Not a regular file or exceeds 8 MiB".into());
    }
    let text = fs::read_to_string(path)?;
    let content = if name == "events.jsonl" {
        let mut lines = String::new();
        for line in text.lines().filter(|line| !line.is_empty()) {
            let mut value: Value = serde_json::from_str(line).unwrap_or_else(
                |_| json!({"detail": "Incomplete journal entry omitted from export"}),
            );
            redact_json(&mut value);
            lines.push_str(&serde_json::to_string(&value)?);
            lines.push('\n');
        }
        lines.into_bytes()
    } else {
        let mut value: Value = serde_json::from_str(&text)?;
        redact_json(&mut value);
        serde_json::to_vec_pretty(&value)?
    };
    Ok(Some(content))
}

fn sector_name(name: &str) -> bool {
    let Some(name) = name
        .strip_prefix("storage-")
        .and_then(|s| s.strip_suffix(".bin"))
    else {
        return false;
    };
    let fields: Vec<_> = name.split('-').collect();
    fields.len() == 5
        && !fields[0].is_empty()
        && fields[0].bytes().all(|b| b.is_ascii_digit())
        && matches!(fields[1], "p0" | "p1" | "p2" | "p3" | "p4")
        && matches!(fields[2], "x1" | "x2" | "x4" | "x8")
        && fields[3]
            .strip_prefix("lba")
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        && matches!(fields[4], "read1" | "read2")
}

fn redact_json(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if matches!(key.as_str(), "serial" | "hardware_id") {
                    *value = Value::String("[redacted]".into());
                } else {
                    redact_json(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_json),
        Value::String(text) => *text = redact(text),
        _ => {}
    }
}

fn redact(text: &str) -> String {
    let mut text = text.to_owned();
    for (prefix, delimiters) in [
        ("/Users/", "/"),
        ("/home/", "/"),
        ("\\Users\\", "\\"),
        ("\\users\\", "\\"),
        ("serial=", " ;\n\r"),
        ("hardware_id=", "]"),
    ] {
        let mut offset = 0;
        while let Some(start) = text[offset..].find(prefix) {
            let start = offset + start + prefix.len();
            let end = text[start..]
                .find(|c| delimiters.contains(c))
                .map_or(text.len(), |n| start + n);
            text.replace_range(start..end, "[redacted]");
            offset = start + "[redacted]".len();
        }
    }
    text
}

fn write_archive(path: &Path, entries: &[Entry]) -> Result<()> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing destination folder")?)?;
    {
        let mut archive = ZipWriter::new(temporary.as_file_mut());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            archive.start_file(name, options)?;
            archive.write_all(data)?;
        }
        archive.finish()?;
    }
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests;
