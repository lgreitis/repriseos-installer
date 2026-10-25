use super::{
    job::{InstallOutcome, Job},
    Result,
};
use reprise_bundle::{
    assembly::{self, Artifacts},
    VerifiedBundle,
};
use reprise_device::{Session, UploadHelper, UploadOptions};
use std::io::Cursor;

pub(super) fn inspect_storage(
    session: Session,
    helper: &UploadHelper,
    bundle: &VerifiedBundle,
    job: &mut Job<'_>,
) -> Result<Session> {
    job.stage("storage", "Checking storage")?;
    let required = assembly::disk_bytes(bundle)?
        .checked_add(crate::theme::disk_bytes(bundle)?)
        .ok_or("Package disk size overflow")?;
    let directory = job.directory.clone();
    let (returned, storage) =
        session.inspect_storage_with_diagnostics(helper, required, Some(&directory), |detail| {
            job.log(detail)
        })?;

    job.save_json("storage.json", &storage)?;
    job.emit(
        format!(
            "{} bytes free; companion present: {}; OSOS present: {}",
            storage.free_bytes, storage.companion_exists, storage.osos_exists
        ),
        None,
    );

    Ok(returned)
}

pub(super) fn install(
    mut session: Session,
    helper: &UploadHelper,
    artifacts: &Artifacts,
    themes: Option<&crate::theme::Themes>,
    action: assembly::BootloaderAction,
    job: &mut Job<'_>,
) -> Result<InstallOutcome> {
    let mut files = Vec::new();
    if let Some(themes) = themes {
        files.push((
            "uploadDefaultTheme",
            "stock artwork",
            "/themes/default/theme.bin",
            &themes.default,
        ));
        files.push((
            "uploadDarkTheme",
            "Dark Mode artwork",
            "/themes/dark/theme.bin",
            &themes.dark,
        ));
    }
    files.extend([
        (
            "uploadLoader",
            "companion loader",
            "/cfw-loader.bin",
            &artifacts.companion,
        ),
        ("uploadOsos", "RepriseOS", "/osos-cfw.bin", &artifacts.osos),
    ]);
    for (stage, name, destination, bytes) in files {
        job.stage(stage, &format!("Preparing {name}"))?;
        let log_job = std::cell::RefCell::new(&mut *job);
        let uploaded = session.upload_with_log(
            helper,
            &mut Cursor::new(bytes),
            UploadOptions {
                destination: destination.into(),
                overwrite: true,
            },
            |p| {
                let detail = match p.stage {
                    "hash" => format!("Checking {name}"),
                    "launch" => "Starting transfer helper".into(),
                    "upload" => format!("Uploading {name}"),
                    "write" => format!("Writing {name}"),
                    "verify" => format!("Verifying {name}"),
                    "dfu-return" => "Reconnecting to iPod".into(),
                    "complete" => format!("Verified {name}"),
                    _ => format!("Preparing {name}"),
                };
                let progress = match p.stage {
                    "hash" | "upload" | "write" | "verify" | "complete" => {
                        Some((p.completed, p.total))
                    }
                    _ => None,
                };
                log_job.borrow_mut().emit(detail, progress);
            },
            |detail| log_job.borrow_mut().log(detail),
        )?;
        session = uploaded.session;
        job.save_json(&format!("{stage}.json"), &uploaded.report)?;
    }
    if action == assembly::BootloaderAction::Keep {
        job.begin_restart()?;
        session.restart()?;
        job.emit(
            "UPDATE: disk files verified; restart requested; NOR unchanged",
            None,
        );
        return Ok(InstallOutcome::FilesUpdated);
    }
    job.begin_bootloader()?;
    session.install_bootloader(&artifacts.nor_installer, |done, total| {
        job.emit(
            "Sending bootloader installer",
            Some((done as u64, total as u64)),
        )
    })?;
    job.emit("Bootloader installer sent", None);
    Ok(InstallOutcome::InstallerSent)
}
