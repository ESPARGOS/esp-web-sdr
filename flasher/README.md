# Firmware installer dependencies

The installer uses the bundled [Espressif esptool-js](https://github.com/espressif/esptool-js)
0.7.0. Release provenance and checksums are recorded in
`vendor/esptool-js-provenance.json`; license texts are retained in `vendor/`.

The application corrects C5 `SPI_REG_BASE` to `0x60003000` because version
0.7.0 inherits C6's `0x60002000`. Recheck this correction when upgrading the
loader, and update `vendor/esptool-js-0.7.0-chips.json` to match its supported
chips. Tests check this list against the bundle.

The installer checks image sizes and SHA-256 hashes before writing, validates
chip and flash capacity, and verifies writes through MD5 readback. These checks
detect corruption; they are not firmware signatures.

UART connections for serial-viewer profiles synchronize at the ROM's 115200 baud, then must switch to
2000000 baud before installation is enabled. If the loader falls back to ROM
speed or cannot change speed, the installer disconnects and displays
"UART too slow for ESP-WebSDR, choose a different dev kit". Native Espressif USB
ports (USB vendor ID 0x303a) are exempt from this UART requirement.

After verification, the installer requests a reset and releases the serial
port. Native USB Serial/JTAG on C3 and C61 uses a watchdog reset; other
connections receive an RTS reset pulse with DTR released. USB devices may
re-enumerate under a different port name. Reset failures leave the verified
installation marked as successful and show manual restart instructions.

The C61 sequence uses the LP watchdog addresses from Espressif's
[C6 target](https://github.com/espressif/esptool/blob/master/esptool/targets/esp32c6.py)
and the watchdog reset enabled by its
[C61 target](https://github.com/espressif/esptool/blob/master/esptool/targets/esp32c61.py).
The bundled JavaScript loader inherits C3 addresses for C61, so the installer
supplies this sequence in `reset.mjs`. C6 uses RTS because upstream disables
its watchdog reset due to a USB controller issue.

## S31 Ethernet / USB profile

Select **ESP32-S31 Function-CoreBoard · Ethernet / USB for SoapyESPSDR** before
connecting. This receive-only profile is for SoapyESPSDR, not the ESP-WebSDR
serial viewer. Its recovery UART flashes at 115200 baud. Use Ethernet or the
separate native high-speed USB connector for samples, and open the board's
DHCP address in a browser for receiver controls. USB Serial/JTAG and UART
remain flashing/debug interfaces. The ordinary S31 profile remains available.

The streaming image includes an ESPARGOS-branded receiver page, automatic
analog bandwidth, and switchable hardware DC calibration. Use the current
SoapyESPSDR driver for residual DC removal. Continuous streaming remains
8-bit I/Q; CS16/CF32 host formats do not add ADC resolution.
