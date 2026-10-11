use super::*;
use std::io::Read;

#[test]
fn archive_contains_only_reports_and_sector_dumps_with_text_redacted() {
    let source = tempfile::tempdir().unwrap();
    let device = br#"{"identity":{"model":"MC293","serial":"SECRET","hardware_id":[1,2]},"detail":"serial=SECRET hardware_id=[01, 02]; /Users/alice/backups"}"#;
    fs::write(source.path().join("device.json"), device).unwrap();
    fs::write(
        source.path().join("events.jsonl"),
        b"{\"detail\":\"DFU return failed\"}\n",
    )
    .unwrap();
    fs::write(source.path().join("result.json"), b"{\"state\":\"failed\"}").unwrap();
    let sector_name = "storage-00-p1-x8-lba394224-read1.bin";
    let sector = vec![0xa5; 512];
    fs::write(source.path().join(sector_name), &sector).unwrap();
    for name in [
        "nor.bin",
        "syscfg.bin",
        "osos-cfw.bin",
        "firmware.ipsw",
        "secret.json",
        "storage-secret.bin",
    ] {
        fs::write(source.path().join(name), b"private").unwrap();
    }
    fs::create_dir(source.path().join("firmware")).unwrap();
    fs::write(source.path().join("firmware/companion.bin"), b"private").unwrap();
    let entries = collect(
        Some(source.path()),
        "serial=SECRET /Users/alice/file C:\\Users\\bob\\file /home/chris/file",
        false,
    )
    .unwrap();
    let destination = tempfile::tempdir().unwrap();
    let path = destination.path().join("debug.zip");
    write_archive(&path, &entries).unwrap();
    let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    assert_eq!(zip.len(), 6);
    let mut raw = Vec::new();
    zip.by_name(sector_name)
        .unwrap()
        .read_to_end(&mut raw)
        .unwrap();
    assert_eq!(raw, sector);
    for name in ["session.txt", "device.json"] {
        let mut text = String::new();
        zip.by_name(name)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        for secret in ["SECRET", "alice", "bob", "chris", "01, 02"] {
            assert!(!text.contains(secret), "{name}: {text}");
        }
        assert!(text.contains("[redacted]"));
    }
    assert_eq!(fs::read(source.path().join("device.json")).unwrap(), device);
    assert!(zip.by_name("nor.bin").is_err());
}

#[test]
fn preview_ignores_real_files_and_early_failures_still_export_session_log() {
    let source = tempfile::tempdir().unwrap();
    fs::write(
        source.path().join("events.jsonl"),
        b"real private diagnostics",
    )
    .unwrap();
    let entries = collect(Some(source.path()), "Simulated failure", true).unwrap();
    assert_eq!(entries.len(), 6);
    assert!(!entries
        .iter()
        .any(|(_, data)| data.windows(4).any(|w| w == b"real")));
    let env: Value = serde_json::from_slice(&entries[1].1).unwrap();
    assert_eq!(env["simulated"], true);
    assert_eq!(
        collect(None, "Failed before job creation", false)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn failed_archive_does_not_replace_existing_destination() {
    let destination = tempfile::tempdir().unwrap();
    let path = destination.path().join("debug.zip");
    fs::write(&path, b"existing").unwrap();
    // Duplicate names force a writer error after the first entry was written.
    let entries = vec![("same".into(), vec![1]), ("same".into(), vec![2])];
    assert!(write_archive(&path, &entries).is_err());
    assert_eq!(fs::read(path).unwrap(), b"existing");
    assert_eq!(fs::read_dir(destination.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn sector_symlinks_are_not_exported() {
    let source = tempfile::tempdir().unwrap();
    let private = tempfile::NamedTempFile::new().unwrap();
    fs::write(private.path(), vec![42; 512]).unwrap();
    std::os::unix::fs::symlink(
        private.path(),
        source.path().join("storage-00-p0-x1-lba0-read1.bin"),
    )
    .unwrap();
    assert_eq!(
        collect(Some(source.path()), "Failure", false)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn interrupted_journal_does_not_prevent_exporting_the_failure() {
    let source = tempfile::tempdir().unwrap();
    fs::write(
        source.path().join("events.jsonl"),
        b"{\"detail\":\"Storage failed\"}\n{\"detail\":\"unfinished",
    )
    .unwrap();
    let entries = collect(Some(source.path()), "Installation stopped", false).unwrap();
    let text = String::from_utf8(
        entries
            .into_iter()
            .find(|(name, _)| name == "events.jsonl")
            .unwrap()
            .1,
    )
    .unwrap();
    let lines: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines[0]["detail"], "Storage failed");
    assert!(lines[1]["detail"]
        .as_str()
        .unwrap()
        .contains("Incomplete journal entry"));
}

#[test]
fn damaged_diagnostics_are_skipped_without_losing_the_rest_of_the_zip() {
    let source = tempfile::tempdir().unwrap();
    fs::write(source.path().join("device.json"), b"{\"identity\":").unwrap();
    fs::write(source.path().join("storage.json"), [0xff]).unwrap();
    fs::create_dir(source.path().join("nor.json")).unwrap();
    fs::write(source.path().join("result.json"), b"{\"state\":\"failed\"}").unwrap();
    fs::write(
        source.path().join("events.jsonl"),
        b"{\"detail\":\"DFU cleanup failed\"}\n",
    )
    .unwrap();
    let good = "storage-00-p0-x1-lba0-read1.bin";
    let bad = "storage-00-p0-x1-lba0-read2.bin";
    fs::write(source.path().join(good), vec![42; 512]).unwrap();
    fs::write(source.path().join(bad), vec![42; 200]).unwrap();
    let entries = collect(Some(source.path()), "Installation failed", false).unwrap();
    let destination = tempfile::tempdir().unwrap();
    let path = destination.path().join("debug.zip");
    write_archive(&path, &entries).unwrap();
    let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    for name in ["session.txt", "events.jsonl", "result.json", good] {
        assert!(zip.by_name(name).is_ok(), "{name}");
    }
    let mut notes = String::new();
    zip.by_name("export-notes.txt")
        .unwrap()
        .read_to_string(&mut notes)
        .unwrap();
    for name in ["device.json", "storage.json", "nor.json", bad] {
        assert!(zip.by_name(name).is_err(), "{name}");
        assert!(notes.contains(name), "{notes}");
    }
    assert_eq!(fs::read(source.path().join(bad)).unwrap().len(), 200);
}

#[test]
fn inaccessible_diagnostic_directory_still_exports_the_session_log() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("not-a-directory");
    fs::write(&file, b"original").unwrap();
    let entries = collect(Some(&file), "Installation failed", false).unwrap();
    assert!(entries.iter().any(|(name, _)| name == "session.txt"));
    let notes = entries
        .iter()
        .find(|(name, _)| name == "export-notes.txt")
        .unwrap();
    assert!(String::from_utf8_lossy(&notes.1).contains("Could not list sector dumps"));
}
