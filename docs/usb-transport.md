# Serial transport

`serial-transport.js` provides `SerialConnection`, shared by `radio.js`, the
viewer, and the installer. Its port contract is the subset of SerialPort used
by the receiver and esptool-js: `open`, `close`, `getInfo`, `setSignals`, and
ReadableStream/WritableStream byte streams. WebSerial ports implement this
contract directly. `NativeUSBPort` implements it over WebUSB and additionally
supports in-place `setBaudRate` for esptool.

Both the installer and viewer prefer WebSerial on desktop and WebUSB on mobile,
with fallback to whichever API is available. Explicit choices in the connection
menus override this default. Mobile detection uses UA Client Hints where
available, with a user-agent fallback including iPadOS desktop-mode detection. Saved
viewer connections include the backend and reuse only an unambiguous granted
VID/PID match. Old saved WebSerial identities remain compatible. USB reconnects
after bootloader resets refresh the device handle using its serial number;
a changed USB identity requires a new selection. Neither backend changes
permissions or installs drivers.

## Native CDC implementation

The chooser filters Espressif VID `0x303a`. Opening checks configuration
descriptors for an ACM control interface (class 2, subclass 2) followed by a
CDC data interface (class 10) with bulk IN/OUT endpoints. This matches native
Espressif Serial/JTAG and S2 ROM CDC descriptors, without hardcoding endpoint
numbers or claiming the separate vendor-specific JTAG interface. A non-CDC
Espressif device is rejected. FT232, CP210x, CH34x and other external adapters
are not supported by the WebUSB backend.

CDC class requests target the control interface: SET_LINE_CODING (0x20, 8N1,
little-endian baud), SET_CONTROL_LINE_STATE (0x22, DTR/RTS), and SEND_BREAK
(0x23). Partial signal updates preserve the other signal. Control requests are
serialized. Opening asserts DTR for CDC firmware that waits for a host.
Espressif native USB is not a physical UART: its line-coding baud does not set
USB throughput. The existing native-device reset policy remains in the radio
and installer.

Reads use a bounded pipeline of eight single-packet bulk transfers, preserving
submission order. This avoids waiting for a short packet on an exact-multiple
reply while keeping USB transfers in flight. Stream backpressure bounds the
pipeline. USB errors and short writes propagate rather than dropping bytes.
Canceling a reader closes the USBDevice to abort pending reads; close does not
wait for the device to send more data. Close is idempotent, and a new open
creates fresh streams. Failed opens release the USB handle.

## Host requirements

WebUSB requires a secure context, browser support, a device grant, and OS
access to the CDC interfaces. It cannot evade browser USB blocklists or OS
permissions. Desktop Linux's `cdc_acm` driver commonly owns these interfaces;
WebSerial is the practical default there. Android browsers with WebUSB can use
native CDC without a WebSerial device provider. Actual Android hardware has
not been tested in this workspace.

### Chromium on desktop Linux: “Unable to claim interface”

A serial client does not need to be open for this error to occur: `cdc_acm`
claims both CDC interfaces as soon as Linux enumerates the device. Closing
serial applications or entering BOOT mode does not unbind that driver. The
normal desktop connection is WebSerial; browser JavaScript cannot detach a
kernel driver. This is a platform limitation described in
[Chrome's WebUSB device requirements](https://developer.chrome.com/docs/capabilities/build-for-webusb).

For an explicit WebUSB experiment, temporarily unbind only the selected board's
CDC control interface. Find its USB interface path with
`udevadm info --query=path --name=/dev/ttyACM0` (substitute the selected board's
serial port). For example, if that path contains `3-1:1.0`, use:

```sh
printf '%s' '3-1:1.0' | sudo tee /sys/bus/usb/drivers/cdc_acm/unbind
```

Replace the example with the actual interface path. Unbinding the CDC control
interface also releases its associated data interface. The serial port will
disappear while WebUSB uses it. After disconnecting WebUSB, restore WebSerial:

```sh
printf '%s' '3-1:1.0' | sudo tee /sys/bus/usb/drivers/cdc_acm/bind
```

Unplugging and reconnecting also restores normal driver binding. A reset that
re-enumerates USB can bind `cdc_acm` again. These are temporary, per-device
steps; disabling `cdc_acm` globally would affect other serial devices too.

The implementation follows the CDC requests used by Google's
[Web Serial polyfill](https://github.com/google/web-serial-polyfill/blob/main/serial.ts).
Espressif documents the native peripheral in its
[USB Serial/JTAG overview](https://docs.espressif.com/projects/esp-iot-solution/en/latest/usb/usb_overview/usb_serial_jtag.html).

## Validation

Run `node --test tests/*.test.mjs`. Transport tests cover descriptor discovery
(including S2 endpoint differences), CDC requests, ordered signals, reading,
writing, cancellation while idle, reopening, failed claims, missing CDC,
transfer errors, backend selection, and USB identity changes. Installer flow
tests cover WebUSB-only browsers and explicit WebUSB selection with WebSerial
present, retaining profile checks and verification behavior.

Hardware checks use an isolated Chromium profile on localhost. Grant each
native device in the browser chooser; on this Linux test host, temporarily
detach the CDC kernel driver before opening and restore it after closing.
Do not detach unrelated interfaces. The test uses the real USBDevice API and
the repository's receiver and installer, without a serial or libusb data shim.

For receiver checks, connect, negotiate capabilities, capture three frames each
at 8-bit and 10-bit I/Q, and run a five-second spectrum stream. Validate capture
CRCs and spectrum CRC errors, then close and reopen. For read-only installer
checks, connect, detect the chip/flash, upload the RAM stub, and disconnect to
reset. The RAM stub is not a flash write. Testing Install itself additionally
requires authorization to replace the selected board's firmware.

### Connected-board results (2026-10-08)

Real Chromium on Linux, final eight-transfer read pipeline:

| Chip | Flash detected | I/Q captures | Spectrum frames in ~5 s | Spectrum CRC errors / host drops |
| --- | --- | --- | ---: | --- |
| ESP32-C3 | 4 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 7,313 | 0 / 0 |
| ESP32-C5 | 16 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 1,531 | 0 / 0 |
| ESP32-C6 | 8 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 4,046 | 0 / 0 |
| ESP32-C61 | 8 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 4,023 | 0 / 0 |
| ESP32-H2 | 4 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 4,522 | 0 / 0 |
| ESP32-S2 | 4 MB | 3 × 8-bit + 3 × 10-bit, all CRC-valid | 1,189 | 0 / 0 |

The JTAG/serial devices supplied 16,380 samples per capture; S2 supplied 12,284.
Spectrum profiles were the first advertised profile for each chip, so their
frame rates are not a like-for-like benchmark. Firmware-side spectrum drops
remain separate from the zero transport CRC errors and zero host queue drops.
On C5/C6, pipelining reduced the time for three 8-bit captures from about
430 ms to 140–150 ms in this setup.

All six boards passed real installer chip detection, RAM-stub upload, flash
capacity detection, and the reset/disconnect path. The S2 initially did not
answer SDR commands; after the installer reset it returned to its existing
SDR firmware and passed the receiver tests. No firmware was replaced.

C3/C61 watchdog resets re-enumerated USB. In this test session Chromium retained
both old and new handles with identical serial numbers; the old handles failed
with Access denied. Restarting the isolated browser cleared them and both
boards passed. The reconnect helper deliberately refuses such ambiguity and
asks for a new selection. Kernel drivers were restored after testing.

A follow-up C6 check read the bootloader, partition-table and application MD5s
through the WebUSB RAM stub. The partition table matched the bundled image.
The bootloader/application differed: the running C6 firmware reports revision
`a0c67e43150becb981ee550e1707ca426bfec7e1`, built 2026-10-08 at 09:24:43 UTC,
whereas the bundled C6 image was built 2026-10-06. Reception worked before the
checksum check and returned CRC-valid 16,380-sample frames at both 8-bit and
10-bit afterward. The user's conditional permission allowed flashing only if
the C6 was not already properly flashed, so its newer working firmware was
preserved.

Actual erase/write installation remains untested on hardware; flash checksum
reads have been tested on C6. The installer write/verification flow is covered
by automated tests. S3/S31 native CDC and mobile hardware were not available
for these checks.
