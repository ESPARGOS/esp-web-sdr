# ESP-WebSDR static firmware flasher

`../flash.html` loads `app.js`, `catalog.mjs`, the local esptool-js module and
`../firmware/manifest.json` directly. Serve the repository on HTTPS or localhost;
there is no template, firmware embedding, or website build step.

Firmware CI produces the combined manifest. Deploy its artifact unchanged into
`firmware/`. Profile labels, chips, versions, flash capacities and write offsets
come from that manifest. An empty/missing/invalid manifest shows an error and
disables connecting; it never silently falls back to another firmware release.
Images are fetched on installation, verified with SHA-256 and size checks, then
written after chip and flash-capacity checks. MD5 readback verifies each write.
Checksums detect corruption; they are not firmware signatures.

Profiles with `flash_size_policy: "minimum"` allow larger physical flash while
retaining their compiled layout. Other profiles require the exact declared
capacity. Unsafe filenames and overlapping/out-of-flash ranges are rejected.
A corrupt or missing image prevents the write operation entirely.

## Browser loader

`vendor/esptool-js-0.7.0.js` is the upstream bundle. Its supported chips are
recorded in `vendor/esptool-js-0.7.0-chips.json`, checked against the bundle by
the tests. This describes browser loader capabilities, not available firmware;
only the runtime firmware manifest defines the options. Unsupported chips are
shown disabled with an explanation. Update this capability file when replacing
the vendored loader. No CDN or runtime dependency download is used.

The application corrects C5 `SPI_REG_BASE` to `0x60003000` because esptool-js
0.7.0 inherits C6's `0x60002000`. Recheck this correction on loader upgrades.
The official release archive and bundle checksums are recorded in
`vendor/esptool-js-provenance.json`. This is a prebuilt dependency update,
not a website build step. Version 0.7.0 includes S31 detection and flashing.
Vendor license texts are retained and linked from the page.

- [Espressif esptool-js](https://github.com/espressif/esptool-js)
- [Firmware artifact contract](../../esp-sdr/docs/web-firmware-artifacts.md)
