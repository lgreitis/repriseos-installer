use reprise_device::{CheckId, CheckReport, DeviceInfo, DeviceSelector, Event, Session};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{ipc::Channel, State};

mod compatibility;

#[derive(Serialize)]
pub struct CheckResponse {
    #[serde(flatten)]
    report: CheckReport,
    issue: Option<compatibility::CompatibilityIssue>,
    check_id: u64,
    hardware_override: bool,
}

#[derive(Default)]
pub struct UsbState {
    busy: Arc<AtomicBool>,
    next_check: AtomicU64,
    pub checked: Mutex<Option<CheckedDevice>>,
}

pub struct CheckedDevice {
    pub session: Session,
    pub report: CheckReport,
    pub package_digest: String,
    pub hardware_policy: reprise_device::firmware::HardwarePolicy,
    check_id: u64,
}

pub struct UsbOperation(Arc<AtomicBool>);

impl UsbState {
    pub fn acquire(&self) -> Result<UsbOperation, CommandError> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| CommandError::new(CheckId::Usb, "An iPod operation is still running."))?;
        Ok(UsbOperation(self.busy.clone()))
    }
}

impl Drop for UsbOperation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    stage: CheckId,
    detail: String,
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.detail)
    }
}

impl CommandError {
    fn new(stage: CheckId, detail: impl ToString) -> Self {
        Self {
            stage,
            detail: detail.to_string(),
        }
    }
}

#[tauri::command]
pub async fn discover_devices(state: State<'_, UsbState>) -> Result<Vec<DeviceInfo>, CommandError> {
    let operation = state.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        reprise_device::discover().map_err(|e| CommandError::new(CheckId::Usb, e))
    })
    .await
    .map_err(|e| CommandError::new(CheckId::Usb, e))?
}

#[tauri::command]
pub async fn check_device(
    selector: DeviceSelector,
    allow_unknown_hardware: Option<u64>,
    on_event: Channel<Event>,
    state: State<'_, UsbState>,
    app: tauri::AppHandle,
) -> Result<CheckResponse, CommandError> {
    use tauri::Manager;
    let operation = state.acquire()?;
    let previous = state
        .checked
        .lock()
        .map_err(|e| CommandError::new(CheckId::Usb, e))?
        .take();
    let check_id = state.next_check.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let bundle = app
            .state::<crate::package::PackageState>()
            .0
            .lock()
            .map_err(|e| CommandError::new(CheckId::Version, e))?
            .clone()
            .ok_or_else(|| {
                CommandError::new(CheckId::Version, "Choose a firmware package first.")
            })?;
        let expected_identity = if let Some(approval) = allow_unknown_hardware {
            let previous = previous.as_ref().ok_or_else(|| {
                CommandError::new(
                    CheckId::Model,
                    "Run device checks again before overriding hardware.",
                )
            })?;
            if previous.check_id != approval
                || previous.package_digest != bundle.digest()
                || previous.report.device.as_ref().map(|d| d.selector) != Some(selector)
                || !compatibility::can_override(&previous.report, &bundle.manifest().compatibility)
            {
                return Err(CommandError::new(
                    CheckId::Model,
                    "Device or package changed. Run device checks again.",
                ));
            }
            previous.report.identity.clone()
        } else {
            None
        };
        drop(previous);
        let policy = if expected_identity.is_some() {
            reprise_device::firmware::HardwarePolicy::AllowUnknown
        } else {
            reprise_device::firmware::HardwarePolicy::RequireKnown
        };
        let devices = reprise_device::discover().map_err(|e| CommandError::new(CheckId::Usb, e))?;
        if !devices
            .iter()
            .any(|device| device.selector == selector && device.dfu_candidate)
        {
            return Err(CommandError::new(
                CheckId::Usb,
                "The iPod disconnected. Return to the DFU guide and reconnect it.",
            ));
        }
        let mut session = Session::open(Some(selector)).map_err(|error| {
            let stage = match &error {
                reprise_device::Error::DeviceCount(_) => CheckId::Usb,
                reprise_device::Error::Invalid(_) => CheckId::Dfu,
                _ => CheckId::Access,
            };
            CommandError::new(stage, error)
        })?;
        let mut report = session.check_with_hardware_policy(policy, |event| {
            // Finish cleanup even if the window stops receiving events.
            let _ = on_event.send(event);
        });
        if expected_identity.is_some() && report.compatible && report.identity != expected_identity
        {
            return Err(CommandError::new(
                CheckId::Model,
                "The iPod identity changed. Run device checks again.",
            ));
        }
        if report.compatible {
            if let Err(detail) = crate::package::require_device_with_policy(
                &bundle.manifest().compatibility,
                &report,
                policy,
            ) {
                report.compatible = false;
                if let Some(check) = report
                    .checks
                    .iter_mut()
                    .find(|check| check.id == CheckId::Version)
                {
                    check.status = reprise_device::CheckStatus::Failed;
                    check.detail = detail;
                    let _ = on_event.send(Event::Check(check.clone()));
                }
            }
        }
        let eligible = compatibility::can_override(&report, &bundle.manifest().compatibility);
        if (report.compatible || eligible) && report.cleanup == reprise_device::Cleanup::Idle {
            *app.state::<UsbState>()
                .checked
                .lock()
                .map_err(|e| CommandError::new(CheckId::Usb, e))? = Some(CheckedDevice {
                session,
                report: report.clone(),
                package_digest: bundle.digest().into(),
                hardware_policy: policy,
                check_id,
            });
        }
        let issue = if eligible {
            let identity = report.identity.as_ref().unwrap();
            Some(compatibility::CompatibilityIssue::UnknownHardware {
                model: identity.model.clone(),
                hardware_version: identity.hardware_version,
            })
        } else {
            compatibility::issue_for_report(&report)
        };
        Ok(CheckResponse {
            report,
            issue,
            check_id,
            hardware_override: expected_identity.is_some(),
        })
    })
    .await
    .map_err(|e| CommandError::new(CheckId::Usb, e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usb_operations_are_exclusive_and_release_after_failure() {
        let state = UsbState::default();
        let operation = state.acquire().unwrap();
        assert!(state.acquire().is_err());
        drop(operation);
        let result: Result<(), ()> = {
            let _operation = state.acquire().unwrap();
            Err(())
        };
        assert!(result.is_err());
        assert!(state.acquire().is_ok());
    }

    #[test]
    fn check_events_and_errors_match_frontend_messages() {
        let event = Event::Check(reprise_device::Check {
            id: CheckId::Rom,
            status: reprise_device::CheckStatus::Running,
            detail: "Reading".into(),
        });
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "event": "check", "id": "rom", "status": "running", "detail": "Reading"
            })
        );
        assert_eq!(
            serde_json::to_value(CommandError::new(CheckId::Access, "Busy")).unwrap(),
            serde_json::json!({"stage": "access", "detail": "Busy"})
        );
        assert_eq!(
            serde_json::to_value(reprise_device::Cleanup::Failed("Disconnected".into())).unwrap(),
            serde_json::json!({"state": "failed", "detail": "Disconnected"})
        );
    }
}
