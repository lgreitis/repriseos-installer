use super::{
    job::{save, Job},
    Result,
};
use reprise_bundle::{
    assembly::{self, Artifacts},
    preparation::{Ipsw, PreparedInputs},
    VerifiedBundle,
};
use reprise_device::{DecryptOptions, Identity, Session, SysCfg};
use std::{fs, path::Path};

pub(super) fn backup(
    session: &mut Session,
    identity: &Identity,
    job: &mut Job<'_>,
) -> Result<Vec<u8>> {
    job.stage("backup", "Backing up boot firmware")?;
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
    save(&job.directory.join("nor.bin"), &nor.bytes)?;
    save(&job.directory.join("syscfg.bin"), &nor.bytes[..syscfg.size])?;
    job.save_json("nor.json", &nor.report)?;
    job.emit("Boot firmware backup saved", None);

    Ok(nor.bytes)
}

pub(super) fn assemble(
    session: &mut Session,
    ipsw: &Ipsw,
    nor: &[u8],
    bundle: &VerifiedBundle,
    data: &Path,
    job: &mut Job<'_>,
) -> Result<Artifacts> {
    job.stage("decrypt", "Preparing Apple firmware")?;
    let cache = data.join("firmware");
    fs::create_dir_all(&cache)?;
    let cache_file = cache.join("osos-2.0.4.bin");
    let osos = match fs::read(&cache_file) {
        Ok(image) => {
            job.emit("Verifying cached Apple firmware", None);
            ipsw.validate_plaintext(&image)?;
            job.emit("Using verified decrypted firmware", None);
            image
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let decrypted =
                session.decrypt(ipsw.ciphertext(), DecryptOptions::default(), None, |p| {
                    job.progress("Decrypting Apple firmware", p.completed, p.total)
                })?;
            job.emit("Verifying decrypted Apple firmware", None);
            let image = ipsw.wrap_plaintext(&decrypted.plaintext)?;
            job.emit("Saving decrypted Apple firmware", None);
            save(&cache_file, &image)?;
            image
        }
        Err(e) => return Err(e.into()),
    };
    job.emit("Preparing Apple loader", None);
    let loader = session.decrypt_nor(nor, |p| {
        job.progress("Decrypting Apple loader", p.completed, p.total)
    })?;
    job.emit("Validating Apple firmware", None);
    let prepared = PreparedInputs::from_plaintext(ipsw, nor, &osos, Some(&loader))?;
    job.stage("assemble", "Preparing RepriseOS")?;
    let artifacts = assembly::assemble(bundle, &prepared.apple_inputs()?, nor)?;
    artifacts.write(&job.directory.join("firmware"))?;

    Ok(artifacts)
}
