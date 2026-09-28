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
