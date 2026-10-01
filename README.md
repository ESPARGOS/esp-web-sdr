# ESP-WebSDR

<img src="docs/espargos-logo.png" width="40%" align="right" alt="ESPARGOS logo">

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

See the [ESP-SDR guide](https://espargos.net/espsdr/) for supported chips and setup.

## On-chip spectrum mode

When supported by the connected firmware and transport, the viewer offers
**On-Chip Spectrum** alongside **I/Q Streaming**. Select a capture-mode button
to show its options beneath it. The viewer queries the device for available sample rates
and FFT sizes. S3, C3, C6 and C61 can keep RF capture running while computing
selected FFT windows. Other validated targets provide on-chip FFTs of repeated
snapshots. The note beside the controls distinguishes these modes, including
when changing FFT size selects a different capture backend.

The default analog bandwidth remains 20 MHz where supported. Switching spectrum
mode or sample rate preserves the selected bandwidth, tuning and gain settings;
**Wide Open** is enabled only when explicitly selected.

Continuous RF capture does not mean that every sample is analyzed or every
short event is visible. The status reports skipped work, dropped frames and
CRC errors. A prolonged host/USB stall can require reconnecting; the viewer
will not reuse a connection whose stream boundary could not be recovered.

The original S3 implementation was contributed by Zoltan Doczi of
[Z2Labs](https://www.z2labs.io/). See the firmware's
[spectrum protocol and validation notes](https://github.com/ESPARGOS/esp-sdr/blob/main/docs/spectrum.md)
for supported profiles and constraints. These changes require matching firmware;
installing the viewer alone does not add device capabilities.

## License

Except where otherwise noted, ESP-WebSDR is free software: you may redistribute
it and/or modify it under the GNU General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your option)
any later version (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full terms.
It is provided without any warranty, including implied warranties of
merchantability or fitness for a particular purpose.

Third-party components retain their own licenses and copyright notices.
Bundled dependency licenses are in `flasher/vendor/`; the font license is in
`fonts.css`. The accompanying [ESP-SDR firmware](https://github.com/ESPARGOS/esp-sdr)
is licensed separately; see its license and third-party notices.
