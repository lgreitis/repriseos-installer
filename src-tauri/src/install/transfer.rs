use super::{
    job::{InstallOutcome, Job},
    Result,
};
use reprise_bundle::{
    assembly::{self, Artifacts},
    VerifiedBundle,
};
use reprise_device::{Session, UploadFile, UploadHelper, UploadOptions};
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

/// One install file: its job stage, the name shown in progress and where it goes.
struct Upload<'a> {
    stage: &'static str,
    name: &'static str,
    destination: &'static str,
    bytes: &'a [u8],
}

pub(super) fn install(
    mut session: Session,
    helper: &UploadHelper,
    artifacts: &Artifacts,
    themes: Option<&crate::theme::Themes>,
    action: assembly::BootloaderAction,
    job: &mut Job<'_>,
) -> Result<InstallOutcome> {
    let mut uploads = Vec::new();
    if let Some(themes) = themes {
        uploads.push(Upload {
            stage: "uploadDefaultTheme",
            name: "stock artwork",
            destination: "/themes/default/theme.bin",
            bytes: &themes.default,
        });
        uploads.push(Upload {
            stage: "uploadDarkTheme",
            name: "Dark Mode artwork",
            destination: "/themes/dark/theme.bin",
            bytes: &themes.dark,
        });
    }
    uploads.extend([
        Upload {
            stage: "uploadLoader",
            name: "companion loader",
            destination: "/cfw-loader.bin",
            bytes: &artifacts.companion,
        },
        Upload {
            stage: "uploadOsos",
            name: "RepriseOS",
            destination: "/osos-cfw.bin",
            bytes: &artifacts.osos,
        },
    ]);
    if helper.supports_batch_upload() {
        session = upload_batch(session, helper, &uploads, job)?;
    } else {
        // Older packages' helpers take one file per launch.
        for file in &uploads {
            session = upload_batch(session, helper, std::slice::from_ref(file), job)?;
        }
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

/// Sends `uploads` through one helper session and saves a report per verified file,
/// also when a later file fails.
fn upload_batch(
    session: Session,
    helper: &UploadHelper,
    uploads: &[Upload<'_>],
    job: &mut Job<'_>,
) -> Result<Session> {
    let mut cursors: Vec<Cursor<&[u8]>> = uploads.iter().map(|u| Cursor::new(u.bytes)).collect();
    let mut files: Vec<UploadFile<'_>> = cursors
        .iter_mut()
        .zip(uploads)
        .map(|(input, upload)| UploadFile {
            input,
            options: UploadOptions {
                destination: upload.destination.into(),
                overwrite: true,
            },
        })
        .collect();
    job.stage(uploads[0].stage, &format!("Preparing {}", uploads[0].name))?;
    let log_job = std::cell::RefCell::new(&mut *job);
    // Hashing runs over every file before the launch and keeps the current stage.
    let mut current = 0;
    let uploaded = session.upload_files(
        helper,
        &mut files,
        |p| {
            let Upload { stage, name, .. } = &uploads[p.file];
            let mut job = log_job.borrow_mut();
            if p.stage != "hash" && current != p.file {
                current = p.file;
                job.stage(stage, &format!("Preparing {name}"))
                    .map_err(|e| reprise_device::Error::Invalid(e.to_string()))?;
            }
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
                "hash" | "upload" | "write" | "verify" | "complete" => Some((p.completed, p.total)),
                _ => None,
            };
            job.emit(detail, progress);
            Ok(())
        },
        |detail| log_job.borrow_mut().log(detail),
    );
    let (session, reports) = match uploaded {
        Ok(uploaded) => (uploaded.session, uploaded.reports),
        Err(failure) => {
            for (upload, report) in uploads.iter().zip(&failure.reports) {
                if let Err(e) = job.save_json(&format!("{}.json", upload.stage), report) {
                    job.log(format!("Could not save {}.json: {e}", upload.stage));
                }
            }
            return Err(failure.into());
        }
    };
    for (upload, report) in uploads.iter().zip(&reports) {
        job.save_json(&format!("{}.json", upload.stage), report)?;
    }
    Ok(session)
}
