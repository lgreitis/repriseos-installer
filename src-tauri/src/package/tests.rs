use super::*;
use reprise_bundle::{
    assembly,
    preparation::{Ipsw, PreparedInputs},
};
use reprise_device::{targets, CheckReport, Cleanup, Identity, SysCfg};
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
fn package_must_match_both_ipsw_and_checked_device() {
    for target in targets::all() {
        let compatibility = &target.compatibility;
        for model in &compatibility.models {
            let mut checked = report(
                Identity {
                    model: model.clone(),
                    serial: "fixture".into(),
                    hardware_id: [0; 16],
                    hardware_version: compatibility.hardware_version,
                    recorded_firmware: compatibility.apple_firmware.clone(),
                },
                &compatibility.bootrom_sha256,
            );
            for candidate in targets::all() {
                let expected = candidate.target == target.target;
                assert_eq!(
                    require_target(&candidate.compatibility, target).is_ok(),
                    expected
                );
                assert_eq!(
                    require_device(&candidate.compatibility, &checked).is_ok(),
                    expected
                );
            }
            checked.bootrom_sha256 = None;
            assert!(require_device(compatibility, &checked).is_err());
            checked.bootrom_sha256 = Some("00".repeat(32));
            assert!(require_device(compatibility, &checked).is_err());
        }
    }
}

#[test]
#[ignore = "requires saved IPSWs, NOR and built release ZIPs; set REPRISE_FIRMWARE_ROOT"]
fn release_packages_replay_with_saved_firmware() {
    let root = PathBuf::from(std::env::var_os("REPRISE_FIRMWARE_ROOT").expect("firmware root"));
    for (target_name, ipsw_name, inputs) in [
        (
            "classic6g-reva-2.0.1",
            "iPod_33.2.0.1.ipsw",
            "inputs/MB565-2.0.1",
        ),
        ("classic7g-2.0.4", "iPod_35.2.0.4.ipsw", "inputs"),
    ] {
        let built = root.join("build/releases").join(target_name);
        let bundle =
            VerifiedBundle::load_local_zip(&built.join("repriseos.zip"), env!("CARGO_PKG_VERSION"))
                .unwrap();
        assert!(VerifiedBundle::load_local_zip(&built.join("repriseos.zip"), "0.1.0").is_err());
        package_info(&bundle, None).unwrap();
        let ipsw = Ipsw::load(&root.join("inputs/ipsw").join(ipsw_name)).unwrap();
        let target = ipsw.metadata.target().unwrap();
        require_target(&bundle.manifest().compatibility, target).unwrap();
        let inputs = root.join(inputs);
        let nor = fs::read(inputs.join("nor.bin")).unwrap();
        let identity = SysCfg::parse(&nor).unwrap().identity().unwrap();
        require_device(
            &bundle.manifest().compatibility,
            &report(identity, &target.compatibility.bootrom_sha256),
        )
        .unwrap();
        let prepared = PreparedInputs::from_plaintext(
            &ipsw,
            &nor,
            &fs::read(inputs.join("osos.bin")).unwrap(),
            Some(&fs::read(inputs.join("apple-loader.bin")).unwrap()),
        )
        .unwrap();
        let apple = prepared.apple_inputs().unwrap();
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
        assert!(!artifacts.nor_installer.is_empty());
    }
}
