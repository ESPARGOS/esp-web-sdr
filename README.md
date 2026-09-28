# ESP-WebSDR

Browser spectrum viewer and firmware installer for ESP32 chips, with live
FFT spectra, waterfalls, tuning, gain and bandwidth controls.

![ESP-WebSDR spectrum and waterfall](docs/spectrum-demo.jpg)

## Get started

1. Use a browser with Web Serial support and connect your board over USB.
2. Install the matching firmware with the [firmware installer](flash.html).
3. Open the [viewer](index.html), connect to the board, and select a frequency.

Close other programs using the serial port. If automatic bootloader entry fails,
hold BOOT, tap RESET, then release BOOT and reconnect in the installer.

Use native USB or UART at **2,000,000 baud, 8N1, no flow control**.
See the [firmware README](../esp-sdr/README.md) for supported chips and wiring.

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
