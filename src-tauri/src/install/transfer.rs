use super::{job::Job, Result};
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
    let required = assembly::disk_bytes(bundle)?;
    let (returned, storage) = session.inspect_storage(helper, required)?;

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
    job: &mut Job<'_>,
) -> Result<()> {
    for (stage, name, destination, bytes) in [
        (
            "uploadLoader",
            "companion loader",
            "/cfw-loader.bin",
            &artifacts.companion,
        ),
        ("uploadOsos", "RepriseOS", "/osos-cfw.bin", &artifacts.osos),
    ] {
        job.stage(stage, &format!("Preparing {name}"))?;
        let uploaded = session.upload(
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
                job.emit(detail, progress);
            },
        )?;
        session = uploaded.session;
        job.save_json(&format!("{stage}.json"), &uploaded.report)?;
    }
    job.begin_bootloader()?;
    session.install_bootloader(&artifacts.nor_installer, |done, total| {
        job.emit(
            "Sending bootloader installer",
            Some((done as u64, total as u64)),
        )
    })?;
    job.emit("Bootloader installer sent", None);
    Ok(())
}
