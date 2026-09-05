//! Serial backend (P2) — the `Serial` arm of the term layer.
//!
//! `serialport` (MPL-2.0) owns the wire; this module provides:
//!
//! * [`SerialIo`] — `TermIo` impl. The read handle is blocking with a
//!   50 ms timeout, so it runs on a dedicated OS thread feeding an mpsc
//!   channel (same shape as the local-PTY reader). Writes go through the
//!   original port handle. resize is a no-op (line console).
//! * [`list_ports`] — port enumeration with USB VID/PID/type metadata for
//!   the connect dialog.
//! * [`ensure_hotplug_watcher`] — lazily started 2 s poller that diffs the
//!   port list and emits `serial:ports-changed` so an open dialog refreshes
//!   when the user plugs in a USB-serial adapter.

use std::io::ErrorKind as IoErrorKind;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serialport::{
    DataBits, ErrorKind as SpErrorKind, FlowControl, Parity, SerialPortType, StopBits,
};
use tokio::sync::mpsc;

use super::{TermError, TermIo};

/// Read poll interval — also the upper bound for noticing an unplug.
const READ_TIMEOUT: Duration = Duration::from_millis(50);

// ---------------------------------------------------------------------------
// TermIo backend
// ---------------------------------------------------------------------------

pub struct SerialIo {
    writer: Box<dyn serialport::SerialPort>,
    rx: mpsc::Receiver<Vec<u8>>,
    stop: Arc<AtomicBool>,
    reader_thread: Option<std::thread::JoinHandle<()>>,
}

impl SerialIo {
    /// Open a serial console. Line settings use the plan defaults
    /// (115200-8N1 configurable through `TermParams::Serial`).
    pub fn open(
        path: &str,
        baud: u32,
        data_bits: u8,
        stop_bits: u8,
        parity: &str,
        flow_control: &str,
    ) -> Result<Self, TermError> {
        let port = serialport::new(path, baud)
            .data_bits(data_bits_kind(data_bits)?)
            .stop_bits(stop_bits_kind(stop_bits)?)
            .parity(parity_kind(parity)?)
            .flow_control(flow_kind(flow_control)?)
            .timeout(READ_TIMEOUT)
            .open()
            .map_err(|e| match e.kind() {
                SpErrorKind::Io(IoErrorKind::PermissionDenied) => TermError::Io(format!(
                    "{path}: permission denied — on Linux add yourself to the `dialout` group (or run `sudo usermod -aG dialout $USER`, then re-login); on macOS check the driver (CH340/FTDI)."
                )),
                SpErrorKind::NoDevice | SpErrorKind::Io(IoErrorKind::NotFound) => {
                    TermError::Io(format!("{path}: port not found — it may have been unplugged"))
                }
                _ => TermError::Io(format!("open {path}: {e}")),
            })?;

        Self::from_port(port, path)
    }

    fn from_port(port: Box<dyn serialport::SerialPort>, path: &str) -> Result<Self, TermError> {
        let mut reader = port
            .try_clone()
            .map_err(|e| TermError::Io(format!("clone {path}: {e}")))?;

        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        let stop = Arc::new(AtomicBool::new(false));
        let reader_stop = stop.clone();
        let reader_thread = std::thread::Builder::new()
            .name(format!("serial-read:{path}"))
            .spawn(move || {
                let mut buf = vec![0u8; 4096];
                while !reader_stop.load(Ordering::Acquire) {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx.blocking_send(buf[..n].to_vec()).is_err() {
                                break; // session loop gone
                            }
                        }
                        Err(e) => match e.kind() {
                            // Timeout = "no data yet" — the normal poll path.
                            // (io::Read surfaces serialport errors as
                            // io::Error with the kind carried over.)
                            IoErrorKind::TimedOut | IoErrorKind::WouldBlock => continue,
                            // Adapter unplugged (NoDevice maps to NotFound).
                            IoErrorKind::NotFound => break,
                            _ => break,
                        },
                    }
                }
            })
            .map_err(|e| TermError::Io(format!("spawn reader: {e}")))?;

        Ok(Self {
            writer: port,
            rx,
            stop,
            reader_thread: Some(reader_thread),
        })
    }
}

#[async_trait::async_trait]
impl TermIo for SerialIo {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self.rx.recv().await {
            Some(chunk) => {
                let n = chunk.len().min(buf.len());
                buf[..n].copy_from_slice(&chunk[..n]);
                Ok(n)
            }
            None => Ok(0), // reader thread ended: unplugged or closed
        }
    }

    async fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.writer
            .write_all(data)
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(data.len())
    }

    async fn resize(&mut self, _cols: u32, _rows: u32) {
        // Serial has no window size.
    }

    async fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.rx.close();
        if let Some(reader) = self.reader_thread.take() {
            let _ = tokio::task::spawn_blocking(move || reader.join()).await;
        }
    }
}

impl Drop for SerialIo {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.rx.close();
    }
}

fn data_bits_kind(bits: u8) -> Result<DataBits, TermError> {
    match bits {
        5 => Ok(DataBits::Five),
        6 => Ok(DataBits::Six),
        7 => Ok(DataBits::Seven),
        8 => Ok(DataBits::Eight),
        other => Err(TermError::InvalidParams(format!(
            "data bits must be 5–8, got {other}"
        ))),
    }
}

fn stop_bits_kind(bits: u8) -> Result<StopBits, TermError> {
    match bits {
        1 => Ok(StopBits::One),
        2 => Ok(StopBits::Two),
        other => Err(TermError::InvalidParams(format!(
            "stop bits must be 1 or 2, got {other}"
        ))),
    }
}

fn parity_kind(parity: &str) -> Result<Parity, TermError> {
    match parity {
        "none" => Ok(Parity::None),
        "even" => Ok(Parity::Even),
        "odd" => Ok(Parity::Odd),
        other => Err(TermError::InvalidParams(format!(
            "parity must be none/even/odd, got {other}"
        ))),
    }
}

fn flow_kind(flow: &str) -> Result<FlowControl, TermError> {
    match flow {
        "none" => Ok(FlowControl::None),
        "hardware" => Ok(FlowControl::Hardware),
        "software" => Ok(FlowControl::Software),
        other => Err(TermError::InvalidParams(format!(
            "flow control must be none/hardware/software, got {other}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/// One port for the connect dialog: OS path, human label, USB identity.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub path: String,
    pub kind: String, // "usb" | "pci" | "bluetooth" | "unknown"
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
}

pub fn list_ports() -> Result<Vec<PortInfo>, TermError> {
    let ports = serialport::available_ports()
        .map_err(|e| TermError::Io(format!("enumerate ports: {e}")))?;
    Ok(ports
        .into_iter()
        .map(|info| {
            let (kind, vid, pid, manufacturer, product) = match info.port_type {
                SerialPortType::UsbPort(usb) => (
                    "usb",
                    Some(usb.vid),
                    Some(usb.pid),
                    usb.manufacturer,
                    usb.product,
                ),
                SerialPortType::PciPort => ("pci", None, None, None, None),
                SerialPortType::BluetoothPort => ("bluetooth", None, None, None, None),
                SerialPortType::Unknown => ("unknown", None, None, None, None),
            };
            PortInfo {
                path: info.port_name,
                kind: kind.to_string(),
                vid,
                pid,
                manufacturer,
                product,
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Hotplug watcher
// ---------------------------------------------------------------------------

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static WATCHER: OnceLock<()> = OnceLock::new();

/// Start (once per process) a 2 s poller diffing the port list and emitting
/// `serial:ports-changed`. Cheap: `available_ports` is a few syscalls.
pub fn ensure_hotplug_watcher(app: AppHandle) {
    WATCHER.get_or_init(|| {
        tokio::spawn(async move {
            let mut prev = current_port_keys();
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let now = current_port_keys();
                if now != prev {
                    let _ = app.emit("serial:ports-changed", &now);
                    prev = now;
                }
            }
        });
    });
}

fn current_port_keys() -> Vec<String> {
    let mut keys: Vec<String> = match serialport::available_ports() {
        Ok(ports) => ports.into_iter().map(|p| p.port_name).collect(),
        Err(_) => Vec::new(),
    };
    keys.sort();
    keys
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_setting_kinds_validate() {
        assert!(matches!(data_bits_kind(8), Ok(DataBits::Eight)));
        assert!(data_bits_kind(9).is_err());
        assert!(matches!(stop_bits_kind(1), Ok(StopBits::One)));
        assert!(stop_bits_kind(3).is_err());
        assert!(matches!(parity_kind("even"), Ok(Parity::Even)));
        assert!(parity_kind("mark").is_err());
        assert!(matches!(flow_kind("hardware"), Ok(FlowControl::Hardware)));
        assert!(flow_kind("rtscts").is_err());
    }

    #[test]
    fn list_ports_never_panics() {
        // Hardware-independent: an empty list is a valid result everywhere.
        let ports = list_ports().unwrap_or_default();
        for p in ports {
            assert!(!p.path.is_empty());
            assert!(["usb", "pci", "bluetooth", "unknown"].contains(&p.kind.as_str()));
        }
    }
}

#[cfg(all(test, unix))]
mod lifecycle_tests {
    use super::*;
    use serialport::SerialPort;
    use std::io::{Read, Write};

    #[tokio::test]
    async fn serial_reader_transfers_bytes_and_joins_on_shutdown() {
        let (mut master, mut slave) = serialport::TTYPort::pair().unwrap();
        master.set_timeout(Duration::from_secs(1)).unwrap();
        slave.set_timeout(READ_TIMEOUT).unwrap();
        let mut io = SerialIo::from_port(Box::new(slave), "test-pty").unwrap();
        master.write_all(b"serial-banner").unwrap();
        let mut buffer = [0; 64];
        let n = tokio::time::timeout(Duration::from_secs(1), io.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&buffer[..n], b"serial-banner");
        io.write(b"serial-input").await.unwrap();
        let n = master.read(&mut buffer).unwrap();
        assert_eq!(&buffer[..n], b"serial-input");
        tokio::time::timeout(Duration::from_secs(1), io.shutdown())
            .await
            .unwrap();
        assert!(io.reader_thread.is_none());
        assert!(io.stop.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn dropping_idle_serial_session_stops_timeout_reader() {
        let (_master, mut slave) = serialport::TTYPort::pair().unwrap();
        slave.set_timeout(READ_TIMEOUT).unwrap();
        let mut io = SerialIo::from_port(Box::new(slave), "test-idle-pty").unwrap();
        let thread = io.reader_thread.take().unwrap();
        drop(io);
        tokio::time::timeout(
            Duration::from_secs(1),
            tokio::task::spawn_blocking(move || thread.join()),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    }
}
