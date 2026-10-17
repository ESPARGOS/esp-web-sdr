# ESP-WebSDR

### Try it yourself: [Project overview](https://espargos.net/espsdr/) · [Browser SDR viewer](https://espargos.net/espsdr/app/) · [Browser firmware installer](https://espargos.net/espsdr/app/flash.html)

<img src="docs/espargos-logo.png" width="40%" align="right" alt="ESPARGOS logo">

Browser spectrum viewer and firmware installer for ESP32 chips, with live
FFT spectra, waterfalls, tuning, gain and bandwidth controls.

With the help of LLMs, we discovered an undocumented feature in Espressif's
ESP32 chips that bypasses the fixed-function modems to capture raw IQ baseband
samples. ESP-WebSDR pairs with the [ESP-SDR firmware](https://github.com/ESPARGOS/esp-sdr)
to display these samples as a live spectrum and waterfall in your browser,
turning supported ESP32 boards into low-cost software-defined radio receivers.

![ESP-WebSDR spectrum and waterfall](docs/spectrum-demo.jpg)

Parts of this code are AI-generated. We put a lot of manual effort into
[pyespargos](https://github.com/ESPARGOS/pyespargos) and the ESPARGOS One
firmware, but haven't reviewed every line of ESP-WebSDR by hand.

## Get started

You need a browser with WebSerial or WebUSB: Chrome, Edge or
[Firefox 151+](https://hacks.mozilla.org/2026/05/web-serial-support-in-firefox/)
on the desktop, or Chrome on Android.

1. Connect the board with a USB data cable and close any serial monitor that
   has its port open.
2. Install the firmware with the [firmware installer](https://espargos.net/espsdr/app/flash.html).
3. Open the [viewer](https://espargos.net/espsdr/app/), click **Connect ESP-SDR**
   and pick the port. Reception starts right away.

The desktop uses WebSerial, which works with both native USB ports and
USB-to-UART bridges. Both APIs need HTTPS or localhost.

The installer also has the **ESP32-S31 Ethernet/USB firmware for
[SoapyESPSDR](https://github.com/ESPARGOS/SoapyESPSDR)**. That firmware streams
continuously to desktop SDR applications and has its own web page at the
board's DHCP address; it does not work with this viewer.

## Android

ESP-WebSDR runs in **Chrome on Android** without an app, using WebUSB.

1. Connect the board's **native USB connector** to the phone, through a USB
   OTG adapter if needed. WebUSB can't use USB-to-UART bridges (CP210x, CH340,
   FT232), so boards without native USB (ESP32, C2) don't work on Android.
2. Install the firmware with the [installer](https://espargos.net/espsdr/app/flash.html):
   tap **Connect via WebUSB** and grant access. If it can't enter the
   bootloader, hold BOOT, tap RESET, release BOOT and try again.
3. Open the [viewer](https://espargos.net/espsdr/app/) and tap
   **Connect ESP-SDR**. If flashing changed the board's USB identity, select it
   again.

<img src="docs/android-chrome-screenshot.jpeg" width="320" alt="ESP-WebSDR in Chrome on Android, showing a live 2.4 GHz power spectrum and waterfall">

## Troubleshooting

**The board isn't listed (Windows/macOS):** a USB-to-UART bridge may need its
manufacturer's driver. Espressif's
[serial connection guide](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32h2/get-started/establish-serial-connection.html)
links to the common ones.

**The port is listed but won't open (Linux):** your user needs access to the
serial device (`/dev/ttyACM0` for native USB, `/dev/ttyUSB0` for bridges).
Add yourself to the serial group (`uucp` on Arch), then log out and back in:

```sh
sudo usermod -aG dialout "$USER"
```

For native Espressif USB ports, a udev rule also works:
`SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", TAG+="uaccess"` in
`/etc/udev/rules.d/70-esp-web-sdr.rules`, then `sudo udevadm control --reload-rules`
and reconnect the board.

**"The device has been lost" right after connecting (Linux):** a program that
used the port before, such as esptool, `idf.py monitor` or anything else built
on pyserial, left it in a mode that Chrome misreads as a disconnect. Reset the
port, or unplug and replug the board:

```sh
stty -F /dev/ttyUSB0 min 1
```

**WebUSB says "Unable to claim interface":** the operating system's driver
owns the port. Use WebSerial instead; see
[USB transport notes](docs/usb-transport.md#chromium-on-desktop-linux-unable-to-claim-interface).

**Flashing fails to enter the bootloader:** hold BOOT, tap RESET, release BOOT
and connect again. Adapters with only TX/RX wired (no DTR/RTS) always need
this, and need a manual reset after flashing.

**Transfer errors on a UART bridge:** some bridges (often CH340) can't keep up
with 2 Mbaud. Use **Switch to 1 Mbaud** in the viewer when it suggests it.

**ESP32-C2 boards:** the packaged firmware is for the common 26 MHz crystal;
the installer checks this before writing.

**Selecting the device again:** after a firmware change that changes the
board's USB identity, pick it again in the viewer.

## Contributors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Jeija">
        <img src="https://github.com/Jeija.png?size=160" width="80" height="80" alt="Florian Euchner"><br>
        <b>Florian Euchner</b>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/zodoczi">
        <img src="https://github.com/zodoczi.png?size=160" width="80" height="80" alt="Zoltan Doczi"><br>
        <b>Zoltan Doczi</b>
      </a>
    </td>
  </tr>
</table>

## License

ESP-WebSDR is licensed under the GNU General Public License, version 3 or
later (`GPL-3.0-or-later`); see [LICENSE](LICENSE). Bundled third-party code
keeps its own license: see `flasher/vendor/` and, for the font, `fonts.css`.
The [ESP-SDR firmware](https://github.com/ESPARGOS/esp-sdr) is licensed
separately.
