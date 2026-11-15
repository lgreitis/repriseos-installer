use super::{
    job::{save, Job},
    Result,
};
use reprise_bundle::{
    assembly::{self, Artifacts},
    preparation::{Ipsw, PreparedInputs},
    VerifiedBundle,
};
use reprise_device::{DecryptOptions, DecryptProgress, Identity, Session, SysCfg};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn backup(
    session: &mut Session,
    identity: &Identity,
    action: assembly::BootloaderAction,
    job: &mut Job<'_>,
) -> Result<Vec<u8>> {
    if action == assembly::BootloaderAction::Keep {
        job.stage("backup", "Checking saved boot firmware backup")?;
        if let Some(bytes) = job.reuse_nor(identity)? {
            return Ok(bytes);
        }
    }
    job.stage("backup", "Backing up boot firmware")?;
    job.log(if action == assembly::BootloaderAction::Keep {
        "BACKUP: no valid backup for this device; reading full NOR"
    } else {
        "BACKUP: fresh full NOR snapshot required before bootloader installation"
    });
    let nor = session.dump_nor(|p| {
        let detail = match p.stage {
            "echo" => "Checking backup connection",
            "nor_verify" => "Verifying boot firmware backup",
            _ => "Reading boot firmware",
        };
        job.progress(detail, p.completed, p.total)
    })?;
    job.emit("Saving boot firmware backup", None);
    let syscfg = SysCfg::parse(&nor.bytes)?;
    if syscfg.identity()? != *identity {
        return Err("NOR identity differs from the checked iPod.".into());
    }
    job.save_nor(&nor, syscfg.size)?;
    job.emit("Boot firmware backup saved", None);

    Ok(nor.bytes)
}

pub(super) fn assemble(
    session: &mut Session,
    ipsw: &Ipsw,
    nor: &[u8],
    bundle: &VerifiedBundle,
    data: &Path,
    hardware_policy: reprise_device::firmware::HardwarePolicy,
    job: &mut Job<'_>,
) -> Result<(Artifacts, Option<crate::theme::Themes>)> {
    job.stage("decrypt", "Preparing Apple firmware")?;
    let cache = data.join("firmware");
    fs::create_dir_all(&cache)?;
    let cache_file = cache.join("osos-2.0.5.bin");
    let osos = match fs::read(&cache_file) {
        Ok(image) => {
            job.emit("Verifying cached Apple firmware", None);
            ipsw.validate_plaintext(&image)?;
            job.emit("Using verified decrypted firmware", None);
            image
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let partial = partial_path(&cache, "osos-2.0.5", ipsw.ciphertext());
            let plaintext = decrypt_resumable(session, ipsw.ciphertext(), &partial, |p| {
                job.progress("Decrypting Apple firmware", p.completed, p.total)
            })?;
            job.emit("Verifying decrypted Apple firmware", None);
            let image = discard_if_invalid(&partial, ipsw.wrap_plaintext(&plaintext))?;
            job.emit("Saving decrypted Apple firmware", None);
            save_or_keep(&cache_file, &image, &partial, &plaintext)?;
            image
        }
        Err(e) => return Err(e.into()),
    };
    let cache_file = cache.join("aupd-2.0.5.bin");
    let aupd = match fs::read(&cache_file) {
        Ok(image) => {
            ipsw.validate_aupd_plaintext(&image)?;
            job.emit("Using verified decrypted Apple loader", None);
            image
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let partial = partial_path(&cache, "aupd-2.0.5", ipsw.aupd_ciphertext());
            let plaintext = decrypt_resumable(session, ipsw.aupd_ciphertext(), &partial, |p| {
                job.progress("Decrypting Apple loader", p.completed, p.total)
            })?;
            discard_if_invalid(&partial, ipsw.validate_aupd_plaintext(&plaintext))?;
            save_or_keep(&cache_file, &plaintext, &partial, &plaintext)?;
            plaintext
        }
        Err(e) => return Err(e.into()),
    };
    job.emit("Validating Apple firmware", None);
    let prepared = PreparedInputs::from_plaintext(ipsw, &osos, &aupd)?;
    job.stage("assemble", "Preparing RepriseOS")?;
    let artifacts = assembly::assemble_with_hardware_policy(
        bundle,
        &prepared.apple_inputs()?,
        nor,
        hardware_policy,
    )?;
    let themes = crate::theme::assemble(bundle, &osos)?;
    job.save_firmware(&artifacts, themes.as_ref())?;

    Ok((artifacts, themes))
}

/// Where the decryption of `ciphertext` keeps its progress. The name carries
/// the ciphertext's hash, so a partial never resumes a different image.
fn partial_path(cache: &Path, name: &str, ciphertext: &[u8]) -> PathBuf {
    let tag: String = Sha256::digest(ciphertext)[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    cache.join(format!("{name}.{tag}.partial"))
}

/// Decrypts `ciphertext` over DFU, continuing from the plaintext a failed
/// attempt left in `partial`. A failure saves what was decrypted so far, so
/// the next attempt after re-entering DFU picks up from there. The partial
/// stays until the caller has verified and saved the image.
fn decrypt_resumable(
    session: &mut Session,
    ciphertext: &[u8],
    partial: &Path,
    mut emit: impl FnMut(DecryptProgress) -> reprise_device::Result<()>,
) -> Result<Vec<u8>> {
    // Best effort: a stale partial only costs disk space.
    let _ = remove_other_partials(partial);
    let mut plaintext = match fs::read(partial) {
        Ok(saved) if resumable(&saved, ciphertext) => saved,
        Ok(_) => Vec::new(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    let start = plaintext.len();
    let mut options = DecryptOptions::default();
    if let Some(iv) = resume_iv(ciphertext, start) {
        options.iv = iv;
    }
    let resumed = |completed| DecryptProgress {
        stage: "decrypt",
        completed,
        total: ciphertext.len(),
    };
    if start > 0 {
        emit(resumed(start))?;
    }
    // A run that finished but failed its DFU cleanup left everything.
    if start == ciphertext.len() {
        return Ok(plaintext);
    }
    let result =
        session.decrypt_into(
            &ciphertext[start..],
            options,
            None,
            &mut plaintext,
            |p| match p.stage {
                "decrypt" => emit(resumed(start + p.completed)),
                // The connection check would restart the bar at 0 after a resume.
                _ if start > 0 => emit(resumed(start)),
                _ => emit(p),
            },
        );
    let source = match result {
        Ok(_) => return Ok(plaintext),
        // Offsets in the error count from where this run started.
        Err(source) if start > 0 => reprise_device::Error::Context {
            context: format!("Resumed at input offset {start:#x}"),
            source: Box::new(source),
        },
        Err(source) => source,
    };
    // Without new chunks, or if they cannot be saved, the partial on disk is
    // still the one to resume.
    let kept = if plaintext.len() > start && save_partial(partial, &plaintext).is_ok() {
        plaintext.len()
    } else {
        start
    };
    if kept == 0 {
        return Err(source.into());
    }
    Err(Box::new(DecryptKept {
        source,
        percent: kept * 100 / ciphertext.len(),
    }))
}

/// A decryption that stopped after saving its plaintext so far.
#[derive(Debug)]
pub(super) struct DecryptKept {
    pub(super) source: reprise_device::Error,
    pub(super) percent: usize,
}

impl std::fmt::Display for DecryptKept {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}. Decryption progress ({}%) is kept for the next attempt.",
            self.source.to_string().trim_end_matches('.'),
            self.percent
        )
    }
}

impl std::error::Error for DecryptKept {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

/// A saved partial is a whole number of AES blocks, no longer than the image.
fn resumable(saved: &[u8], ciphertext: &[u8]) -> bool {
    !saved.is_empty() && saved.len().is_multiple_of(16) && saved.len() <= ciphertext.len()
}

/// CBC: a run resuming at `start` takes the preceding ciphertext block as IV.
fn resume_iv(ciphertext: &[u8], start: usize) -> Option<[u8; 16]> {
    (start >= 16).then(|| ciphertext[start - 16..start].try_into().unwrap())
}

/// A partial whose image fails verification is dropped, so a bad one costs a
/// single run.
fn discard_if_invalid<T, E: Into<Box<dyn std::error::Error + Send + Sync>>>(
    partial: &Path,
    result: std::result::Result<T, E>,
) -> Result<T> {
    result.map_err(|e| {
        // The verification error matters more than a failed removal.
        let _ = remove_partial(partial);
        e.into()
    })
}

/// Saves the verified image and drops the partial. If the image cannot be
/// saved, a half-written image is removed, since the next attempt would trust
/// it, and the plaintext goes back into the partial instead.
fn save_or_keep(cache_file: &Path, image: &[u8], partial: &Path, plaintext: &[u8]) -> Result<()> {
    if let Err(e) = save(cache_file, image) {
        let existed = e
            .downcast_ref::<std::io::Error>()
            .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists);
        if !existed && cache_file.is_file() {
            let _ = fs::remove_file(cache_file);
        }
        let _ = save_partial(partial, plaintext);
        return Err(e);
    }
    remove_partial(partial)
}

/// Removes partials and their temporary files left by other images under the
/// same name.
fn remove_other_partials(partial: &Path) -> Result<()> {
    let (Some(directory), Some(file)) = (partial.parent(), partial.file_name()) else {
        return Ok(());
    };
    let file = file.to_string_lossy();
    // "osos-2.0.5.<hash>.partial" -> "osos-2.0.5."
    let Some(prefix) = file
        .strip_suffix(".partial")
        .and_then(|stem| stem.rsplit_once('.'))
        .map(|(name, _)| format!("{name}."))
    else {
        return Ok(());
    };
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        let stale = name.starts_with(&prefix)
            && (name.ends_with(".partial") || name.ends_with(".partial.tmp"))
            && path != partial;
        if stale {
            remove_partial(&path)?;
        }
    }
    Ok(())
}

fn save_partial(partial: &Path, plaintext: &[u8]) -> Result<()> {
    let temporary = partial.with_extension("partial.tmp");
    remove_partial(&temporary)?;
    save(&temporary, plaintext)?;
    fs::rename(&temporary, partial)?;
    Ok(())
}

fn remove_partial(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests;
