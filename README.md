# ESP-WebSDR

A static browser SDR viewer and firmware installer. **No website build step,
package installation, or generated HTML is required.** The viewer supports
C5/C6/C61/S3/S31 protocol-6 snapshots over integrated USB Serial/JTAG and
original ESP32/C6/C61/S3/S31 over UART0. The original ESP32 uses 2 MBaud UART,
80/40/16 MS/s snapshots, Wi-Fi channel centers from 2412–2472 MHz, and
approximate 12–67 MHz analog bandwidth control plus wide open.

## Serve the website

Publish the repository's static files on an HTTPS server. For local use:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/` for the viewer or `/flash.html` for the installer.
Use a browser with Web Serial support. Loading local files with `file://` does
not support the module/fetch setup; localhost is sufficient and needs no build.
Fonts, JavaScript and flashing tools are served locally, with no CDN dependency.

`index.html` is the viewer; `flash.html` is the flasher. Keep `flasher/`,
`firmware/`, the JavaScript/CSS files and logo alongside these entry points.
The pages also work when hosted under a subdirectory.

## Firmware artifacts

Download and extract `esp-sdr-firmware` from the firmware CI workflow. Its root
contains a combined `manifest.json` and one directory per firmware profile.
Deploy those contents as this website's `firmware/` directory:

```text
index.html
flash.html
flasher/
firmware/
  manifest.json
  esp32c5/*.bin
  esp32c61/*.bin
  esp32s3/*.bin
  esp32s31/*.bin
```

The flasher fetches the manifest when opened and populates options directly
from it. It downloads only the selected profile's images when installing, then
checks sizes and SHA-256 hashes before any flash writes. Chip/flash-size checks
and device MD5 readback remain in place. Replace the entire firmware folder
when publishing a release; no website source edits or build commands are needed.
The checked-in firmware folder contains the current receive-only builds.

The bundled upstream esptool-js 0.7.0 supports flashing all four profiles,
including S31. New firmware options appear from the manifest automatically;
new transports may still need viewer support. S31 retains its Function-CoreBoard,
16 MB flash and Octal PSRAM requirements. See [the artifact contract](../esp-sdr/docs/web-firmware-artifacts.md).

## Connecting

Use either native USB Serial/JTAG or the C6/C61/S3/S31 board's USB-to-UART bridge. UART
uses 2000000 baud, 8N1, no flow control. Default TX/RX pins are S3: 43/44,
C6: 16/17, C61: 11/10, and S31: 58/59.
Native USB ignores the baud setting. Close other software using the serial
interface. One client owns the radio at a time; disconnect releases it, or
wait five seconds after an idle client. The viewer retries synchronization if
opening a serial port resets the board.

## Receive

Hardware AGC is the default. Manual gain remains available; software AGC is
not supported. Controls, live measurements and operation status stay in the
viewer; detailed explanations belong in this documentation.

The viewer provides FFT spectrum, waterfall, gain and analog bandwidth controls,
and software snapshot triggers. Available
controls depend on firmware capabilities. Snapshot sampling has gaps; nominal RF
sample rate is not continuous serial throughput; UART delivers fewer samples per second than native USB. Display power is uncalibrated dBFS.
Wi-Fi/BLE triggers identify candidates, not decoded or CRC-validated packets.

Browser receive times are not hardware timestamps.

## Checks

`node --test tests/*.test.mjs` checks manifest validation and firmware downloads.
The website workflow runs these checks and optionally packages the unchanged
static files as an artifact; it does not compile or generate the website.

Typography uses bundled Carlito regular/bold, matching espargos.net. Its SIL
Open Font License is retained in `fonts.css`; flashing dependency notices live
in `flasher/vendor/` and are linked from the flasher.

C61 UART0 uses GPIO11 (TX) and GPIO10 (RX), at 2 Mbaud. The browser negotiates the chip and capture size from the protocol-6 identity.

## Receiver capabilities

The viewer reads `LIMITS?` during connection when `CAPS` advertises `RXLIMITS`.
Gain slider bounds and steps, analog bandwidth in MHz, sample rates and sample
precision come from the firmware. Manual gain selects a calibrated table index;
it is not an absolute RF gain in dB. Hardware AGC remains the default.

Analog bandwidth is approximate and chip-specific: C61/S31 support 13–54 MHz,
S3 supports 13–69 MHz, and “Wide open” selects minimum filter capacitance.
These are analog passband settings, independent of the sample-rate setting;
they do not provide arbitrary narrow anti-alias filters for decimated captures.
C5 stays on its calibrated automatic filter because no verified MHz mapping is
available. Older firmware without `RXLIMITS` uses the range reported by `GAIN?`
and has no manual MHz control. No raw filter codes are shown in the viewer.

S31 snapshots use native 8-bit I/Q at 16, 8 or 4 MS/s. The UI disables 10-bit
capture and the OFDM trigger, whose detector requires at least 20 MS/s.
Serial snapshots have gaps while data is transferred; the existing S31
Ethernet/vendor-USB transports retain their continuous streaming protocol.

## ESP32-C6 support

C6 uses the shared serial burst protocol at 2 Mbaud UART. The receiver supports IQ8/IQ10, gain control and nominal 80 MS/s snapshots. Firmware with `TUNEEXT` attempts whole-MHz tuning from 2100–2800 MHz using the direct PLL path; nonstandard Wi-Fi centers show a warning without stopping capture. This is an attempt range, not a guarantee of PLL lock or reception. Older firmware requires an update for extended tuning. The web app uses the firmware's advertised limits; the analog-bandwidth slider supports approximately 12–54 MHz. Lower sample rates remain unavailable on the verified capture path. C6 firmware is included in the installer. Hardware validation used UART on C6 revision 0.1; native USB also passed extended-tuning and IQ8/IQ10 CRC checks.
