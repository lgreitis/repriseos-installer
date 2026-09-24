use super::*;

fn job(state: &InstallState) -> Job<'_> {
    let directory = backup_directory(&std::env::temp_dir(), b"reprise-job-test").unwrap();
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
        let outcome = if failed {
            Err("Disconnected".into())
        } else {
            Ok(())
        };
        let result = job.finish(outcome);
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("result.json")).unwrap()).unwrap();

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
