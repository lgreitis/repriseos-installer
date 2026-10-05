use reprise_device::{CheckId, CheckReport, DeviceInfo, DeviceSelector, Event, Session};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub struct UsbState {
    busy: Arc<AtomicBool>,
    pub checked: Mutex<Option<CheckedDevice>>,
}

pub struct CheckedDevice {
    pub session: Session,
    pub report: CheckReport,
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
    on_event: Channel<Event>,
    state: State<'_, UsbState>,
    app: tauri::AppHandle,
) -> Result<CheckReport, CommandError> {
    use tauri::Manager;
    let operation = state.acquire()?;
    state
        .checked
        .lock()
        .map_err(|e| CommandError::new(CheckId::Usb, e))?
        .take();
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
        let mut report = session.check(|event| {
            // Finish cleanup even if the window stops receiving events.
            let _ = on_event.send(event);
        });
        if report.compatible {
            if let Err(detail) =
                crate::package::require_device(&bundle.manifest().compatibility, &report)
            {
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
        if report.compatible && report.cleanup == reprise_device::Cleanup::Idle {
            *app.state::<UsbState>()
                .checked
                .lock()
                .map_err(|e| CommandError::new(CheckId::Usb, e))? = Some(CheckedDevice {
                session,
                report: report.clone(),
            });
        }
        Ok(report)
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
