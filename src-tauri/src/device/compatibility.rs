use reprise_device::{CheckId, CheckReport, CheckStatus, Cleanup};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CompatibilityIssue {
    UnsupportedModel { model: String },
    PackageMismatch { model: String },
}

pub fn issue_for_report(report: &CheckReport) -> Option<CompatibilityIssue> {
    if report.compatible || report.cleanup != Cleanup::Idle {
        return None;
    }
    let failed = report
        .checks
        .iter()
        .find(|check| check.status == CheckStatus::Failed)?;
    let identity = report.identity.as_ref()?;
    match failed.id {
        CheckId::Model => Some(CompatibilityIssue::UnsupportedModel {
            model: identity.model.clone(),
        }),
        CheckId::Version => Some(CompatibilityIssue::PackageMismatch {
            model: identity.model.clone(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reprise_device::{Check, Identity};

    fn report(model: &str, hardware: u32, firmware: &str, failed: CheckId) -> CheckReport {
        CheckReport {
            schema_version: 1,
            source: "test",
            device: None,
            bootrom_sha256: None,
            checks: vec![Check {
                id: failed,
                status: CheckStatus::Failed,
                detail: "Technical diagnostic".into(),
            }],
            identity: Some(Identity {
                model: model.into(),
                serial: "test".into(),
                hardware_id: [0; 16],
                hardware_version: hardware,
                recorded_firmware: firmware.into(),
            }),
            cleanup: Cleanup::Idle,
            compatible: false,
        }
    }

    #[test]
    fn compatibility_reasons_use_identity_and_manifest_not_diagnostic_text() {
        for (model, hardware, firmware, failed, expected) in [
            (
                "MA002",
                0x000b0000,
                "1.1.2",
                CheckId::Model,
                serde_json::json!({"kind": "unsupported_model", "model": "MA002"}),
            ),
            (
                "MC293",
                0x00130200,
                "2.0.4",
                CheckId::Version,
                serde_json::json!({"kind": "package_mismatch", "model": "MC293"}),
            ),
            (
                "MB565",
                0x00130100,
                "2.0",
                CheckId::Version,
                serde_json::json!({"kind": "package_mismatch", "model": "MB565"}),
            ),
        ] {
            let checked = report(model, hardware, firmware, failed);
            assert_eq!(
                serde_json::to_value(issue_for_report(&checked)).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn cleanup_and_incomplete_identity_keep_their_original_errors() {
        let mut checked = report("MA002", 0x000b0000, "1.1.2", CheckId::Model);
        checked.cleanup = Cleanup::Failed("Disconnected".into());
        assert!(issue_for_report(&checked).is_none());
        checked.cleanup = Cleanup::Idle;
        checked.identity = None;
        assert!(issue_for_report(&checked).is_none());
        let checked = report("MC293", 0x00130200, "2.0.4", CheckId::Rom);
        assert!(issue_for_report(&checked).is_none());
    }
}
