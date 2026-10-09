use super::*;
use reprise_bundle::{
    assembly,
    preparation::{Ipsw, PreparedInputs},
};
use reprise_device::{firmware, CheckReport, Cleanup, Identity, SysCfg};
use std::{fs, path::PathBuf};

fn report(identity: Identity, bootrom: &str) -> CheckReport {
    CheckReport {
        schema_version: 1,
        source: "test",
        device: None,
        checks: vec![],
        bootrom_sha256: Some(bootrom.into()),
        identity: Some(identity),
        cleanup: Cleanup::Idle,
        compatible: true,
    }
}

#[test]
fn package_accepts_classic_hardware_independent_of_model_and_installed_firmware() {
    let target = firmware::current();
    let compatibility = &target.compatibility;
    require_target(compatibility, target).unwrap();
    let mut wrong = compatibility.clone();
    wrong.target = "classic7g-2.0.4".into();
    assert!(require_target(&wrong, target).is_err());
    for (model, hardware, installed) in [
        ("MB029", 0x00130000, "1.1.2"),
        ("MB565", 0x00130100, "2.0.1"),
        ("MC293", 0x00130200, "2.0.4"),
        ("MC297", 0x00130300, "2.0.5"),
        ("PC293", 0x00130200, "2.0.2"),
        ("PC297", 0x00130300, "2.0.4"),
    ] {
        let mut checked = report(
            Identity {
                model: model.into(),
                serial: "fixture".into(),
                hardware_id: [0; 16],
                hardware_version: hardware,
                recorded_firmware: installed.into(),
            },
            &compatibility.bootrom_sha256,
        );
        require_device(compatibility, &checked).unwrap();
        checked.bootrom_sha256 = None;
        assert!(require_device(compatibility, &checked).is_err());
        checked.bootrom_sha256 = Some("00".repeat(32));
        assert!(require_device(compatibility, &checked).is_err());
        checked.bootrom_sha256 = Some(compatibility.bootrom_sha256.clone());
        checked.identity.as_mut().unwrap().hardware_version = 0x000b0000;
        assert!(require_device(compatibility, &checked).is_err());
    }
}

#[test]
#[ignore = "requires saved IPSW, NOR and built release ZIP; set REPRISE_FIRMWARE_ROOT"]
fn release_package_replays_with_each_devices_identity() {
    let root = PathBuf::from(std::env::var_os("REPRISE_FIRMWARE_ROOT").expect("firmware root"));
    let built = root.join("build/releases/classic");
    let bundle =
        VerifiedBundle::load_local_zip(&built.join("repriseos.zip"), env!("CARGO_PKG_VERSION"))
            .unwrap();
    assert!(VerifiedBundle::load_local_zip(&built.join("repriseos.zip"), "0.1.3").is_err());
    package_info(&bundle, None).unwrap();
    let ipsw = Ipsw::load(&root.join("inputs/ipsw/iPod_38.2.0.5.ipsw")).unwrap();
    let target = ipsw.metadata.target().unwrap();
    require_target(&bundle.manifest().compatibility, target).unwrap();
    let inputs = root.join("inputs/firmware-2.0.5");
    let prepared = PreparedInputs::from_plaintext(
        &ipsw,
        &fs::read(inputs.join("osos.bin")).unwrap(),
        &fs::read(inputs.join("aupd.decrypted.body.bin")).unwrap(),
    )
    .unwrap();
    let apple = prepared.apple_inputs().unwrap();
    let mut companions = Vec::new();
    for backup in ["inputs/nor.bin", "inputs/MB565-2.0.1/nor.bin"] {
        let nor = fs::read(root.join(backup)).unwrap();
        let cfg = SysCfg::parse(&nor).unwrap();
        require_device(
            &bundle.manifest().compatibility,
            &report(
                cfg.identity().unwrap(),
                &target.compatibility.bootrom_sha256,
            ),
        )
        .unwrap();
        let artifacts = assembly::assemble(&bundle, &apple, &nor).unwrap();
        assert_eq!(
            artifacts.osos,
            assembly::assemble_local(
                &fs::read(built.join("osos.json")).unwrap(),
                &fs::read(built.join("osos.data")).unwrap(),
                &inputs
            )
            .unwrap()
        );
        assert_eq!(
            artifacts.companion,
            assembly::assemble_local_companion(
                &fs::read(built.join("companion.json")).unwrap(),
                &fs::read(built.join("companion.data")).unwrap(),
                &inputs,
                &nor
            )
            .unwrap()
        );
        let sysinfo = &artifacts.companion[0x25100..0x25220];
        assert_eq!(&sysinfo[0x18..0x28], &cfg.entries["SrNm"]);
        assert_eq!(&sysinfo[0x38..0x40], &cfg.entries["FwId"][4..12]);
        assert_eq!(&sysinfo[0x98..0xa8], &cfg.entries["Mod#"]);
        assert_eq!(&sysinfo[0x92..0x96], &cfg.entries["Regn"][4..8]);
        assert_eq!(&sysinfo[0x84..0x88], &0x00130300u32.to_le_bytes());
        assert_eq!(&sysinfo[0x11c..0x120], &0x01808003u32.to_le_bytes());
        assert!(!artifacts.nor_installer.is_empty());
        companions.push(artifacts.companion);
    }
    assert_ne!(companions[0], companions[1]);
    assert_eq!(companions[0][..0x25100], companions[1][..0x25100]);
    assert_eq!(companions[0][0x25220..], companions[1][0x25220..]);
}
