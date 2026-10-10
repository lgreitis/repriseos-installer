use super::*;

fn job(state: &InstallState) -> Job<'_> {
    let device = format!("reprise-job-test-{:?}", std::thread::current().id());
    let directory = backup_directory(&std::env::temp_dir(), device.as_bytes()).unwrap();
    Job::new(state, Channel::new(|_| Ok(())), directory).unwrap()
}

#[test]
fn bootloader_handoff_honors_pending_cancellation_and_closes_further_requests() {
    let state = InstallState::default();
    *state.cancellation.lock().unwrap() = super::super::Cancellation {
        requested: true,
        allowed: true,
    };
    let mut job = job(&state);
    let directory = job.directory.clone();

    assert!(job.begin_bootloader().is_err());
    assert!(state.cancellation.lock().unwrap().allowed);

    state.cancellation.lock().unwrap().requested = false;
    job.begin_bootloader().unwrap();
    assert!(!state.cancellation.lock().unwrap().allowed);
    drop(job);

    let events: Vec<serde_json::Value> = fs::read_to_string(directory.join("events.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["cancellable"], true);
    assert_eq!(events[1]["cancellable"], false);
    assert_eq!(events[1]["stage"], "bootloader");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn outcomes_preserve_result_files_and_recovery_details() {
    let state = InstallState::default();
    for failed in [false, true] {
        let mut job = job(&state);
        let directory = job.directory.clone();
        job.stage("backup", "Reading boot firmware").unwrap();
        job.log("Helper status: rc=-301");
        let outcome = if failed {
            Err("Disconnected".into())
        } else {
            Ok(())
        };
        let result = job.finish(outcome);
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("result.json")).unwrap()).unwrap();
        let events: Vec<serde_json::Value> = fs::read_to_string(directory.join("events.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(events[0]["diagnostic"], false);
        assert_eq!(events[1]["diagnostic"], true);
        assert_eq!(events[1]["stage"], "backup");
        assert_eq!(events[1]["detail"], "Helper status: rc=-301");

        if failed {
            let error = result.err().unwrap().to_string();
            assert!(error.contains("Disconnected"));
            assert!(error.contains(directory.to_str().unwrap()));
            assert!(error.contains("Re-enter DFU"));
            assert_eq!(saved["state"], "failed");
            assert_eq!(saved["stage"], "backup");
            assert_eq!(saved["detail"], error);
        } else {
            assert_eq!(result.unwrap().backup_path, directory.to_string_lossy());
            assert_eq!(saved["state"], "installer_sent");
        }
        fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn backup_never_overwrites_a_previous_file() {
    let directory = std::env::temp_dir().join(format!(
        "reprise-backup-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&directory).unwrap();
    let file = directory.join("nor.bin");
    save(&file, b"original").unwrap();
    assert!(save(&file, b"replacement").is_err());
    assert_eq!(fs::read(&file).unwrap(), b"original");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn nor_snapshots_are_reused_verified_and_separated_by_device_and_content() {
    let root = backup_directory(&std::env::temp_dir(), b"reprise-nor-test").unwrap();
    let state = InstallState::default();
    let make_job = |device: &[u8]| {
        Job::new(
            &state,
            Channel::new(|_| Ok(())),
            backup_directory(&root, device).unwrap(),
        )
        .unwrap()
    };
    let mut nor = NorDump {
        bytes: b"original".to_vec(),
        report: reprise_device::NorReport {
            schema_version: 1,
            bytes: 8,
            sha256: "original-hash".into(),
            seconds: 0.0,
            cross_checked: true,
            cleanup: reprise_device::Cleanup::Idle,
        },
    };
    let first = make_job(b"device-a");
    first.save_nor(&nor, 4).unwrap();
    let snapshot = first.device_directory.join("nor/original-hash/nor.bin");
    let modified = fs::metadata(&snapshot).unwrap().modified().unwrap();
    let second = make_job(b"device-a");
    second.save_nor(&nor, 4).unwrap();
    assert_eq!(
        fs::metadata(&snapshot).unwrap().modified().unwrap(),
        modified
    );
    assert!(!second.directory.join("nor.bin").exists());
    let reference: serde_json::Value =
        serde_json::from_slice(&fs::read(second.directory.join("nor.json")).unwrap()).unwrap();
    assert_eq!(
        fs::read(second.directory.join(reference["backup"].as_str().unwrap())).unwrap(),
        nor.bytes
    );

    let other = make_job(b"device-b");
    other.save_nor(&nor, 4).unwrap();
    assert_ne!(first.device_directory, other.device_directory);
    assert_eq!(
        fs::read(other.device_directory.join("nor/original-hash/nor.bin")).unwrap(),
        nor.bytes
    );

    fs::write(&snapshot, b"damaged").unwrap();
    assert!(second.save_nor(&nor, 4).is_err());
    assert_eq!(fs::read(&snapshot).unwrap(), b"damaged");
    nor.bytes = b"modified".to_vec();
    nor.report.sha256 = "modified-hash".into();
    let third = make_job(b"device-a");
    third.save_nor(&nor, 4).unwrap();
    assert_eq!(
        fs::read_dir(first.device_directory.join("nor"))
            .unwrap()
            .count(),
        2
    );
    drop((first, second, third, other));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn firmware_is_replaced_per_device_while_run_reports_remain() {
    let root = backup_directory(&std::env::temp_dir(), b"reprise-firmware-test").unwrap();
    let state = InstallState::default();
    let mut artifacts = Artifacts {
        osos: b"first".to_vec(),
        companion: b"companion".to_vec(),
        nor_installer: b"installer".to_vec(),
    };
    let mut reports = Vec::new();
    for (device, osos) in [
        (b"a", b"first".as_slice()),
        (b"b", b"other"),
        (b"a", b"latest"),
    ] {
        let job = Job::new(
            &state,
            Channel::new(|_| Ok(())),
            backup_directory(&root, device).unwrap(),
        )
        .unwrap();
        artifacts.osos = osos.to_vec();
        job.save_firmware(&artifacts).unwrap();
        assert!(!job.directory.join("firmware").exists());
        reports.push(job.directory.join("assembly.json"));
    }
    assert_eq!(
        fs::read(root.join("backups/61/firmware/osos-cfw.bin")).unwrap(),
        b"latest"
    );
    assert_eq!(
        fs::read(root.join("backups/62/firmware/osos-cfw.bin")).unwrap(),
        b"other"
    );
    for report in reports {
        let json: serde_json::Value = serde_json::from_slice(&fs::read(report).unwrap()).unwrap();
        assert!(json["files"]["osos-cfw.bin"]["sha256"].is_string());
    }
    fs::remove_dir_all(root).unwrap();
}
