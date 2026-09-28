# ESP-WebSDR

Browser spectrum viewer and firmware installer for ESP32 chips, with live
FFT spectra, waterfalls, tuning, gain and bandwidth controls.

With the help of LLMs, we discovered an undocumented feature in Espressif's
ESP32 chips that bypasses the fixed-function modems to capture raw IQ baseband
samples. ESP-WebSDR pairs with the [ESP-SDR firmware](https://github.com/ESPARGOS/esp-sdr)
to display these samples as a live spectrum and waterfall in your browser,
turning supported ESP32 boards into low-cost software-defined radio receivers.

![ESP-WebSDR spectrum and waterfall](docs/spectrum-demo.jpg)

**Parts of this code are AI-generated.**
While we put a lot of manual effort into [pyespargos](https://github.com/ESPARGOS/pyespargos) and the firmware for our ESPARGOS One arrays, we don't have the time to manually review all of the source code for ESP-WebSDR.

## Get started

1. Use a browser with Web Serial support and connect your board over USB.
2. Install the matching firmware with the [firmware installer](https://espargos.net/espsdr/app/flash.html).
3. Open the [viewer](https://espargos.net/espsdr/app/), connect to the board, and select a frequency.

Close other programs using the serial port. If automatic bootloader entry fails,
hold BOOT, tap RESET, then release BOOT and reconnect in the installer.

Use native USB or UART at **2,000,000 baud, 8N1, no flow control**.
See the [ESP-SDR guide](https://espargos.net/espsdr/) for supported chips and setup.

ESP32-C3 firmware supports native USB, 80 MS/s IQ8/IQ10 snapshots, and
approximately 14–62 MHz analog bandwidth. Tune to Wi-Fi channel centers
2412–2472 MHz in 5 MHz steps, or 2484 MHz. The viewer discovers these controls
automatically from the firmware.

## Receive controls

Hardware AGC is the default. Manual gain uses PHY table indices, not dB.
The viewer starts at 80 MS/s and 20 MHz bandwidth when supported, with short
trace averaging. Analog bandwidth is approximate; “Wide open” selects the
widest filter setting.

Captures have gaps. Sample rate describes each snapshot, not sustained USB/UART
throughput. Power is uncalibrated dBFS. Extended tuning may show a warning;
reception outside standard Wi-Fi centers is not guaranteed. Disconnect before
switching clients.

## Development

Run checks with `node --test tests/*.test.mjs`.
Bundled dependency licenses are in `flasher/vendor/`; the font license is in
`fonts.css`.
