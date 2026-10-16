import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../radio.js', import.meta.url), 'utf8');

function radioFor(identity) {
  const context = vm.createContext({ performance });
  vm.runInContext(source, context);
  const radio = vm.runInContext('radio', context);
  radio.applyIdentity(identity);
  radio.hasExtendedTune = true;
  radio.tuneRange = [100, 6000];
  return radio;
}

test('warnings mention the measured reception range only outside it', () => {
  const h2 = radioFor('H2SDR 6 burst 16380');
  assert.equal(h2.frequencyWarning(2442), '');
  assert.match(h2.frequencyWarning(2500), /PLL may not lock/);
  assert.match(h2.frequencyWarning(2200), /ESP32-H2 received a test tone at 2300–2650 MHz/);
  const c5 = radioFor('C5SDR 6 burst 16380');
  assert.equal(c5.frequencyWarning(5500), '');
  assert.match(c5.frequencyWarning(2100), /2200–2650 MHz and 5180–5800 MHz/);
  const s31 = radioFor('S31SDR 6 burst 16380');
  assert.match(s31.frequencyWarning(2200), /PLL may not lock/);
  assert.match(s31.frequencyWarning(2100), /2150–2750 MHz/);
});

test('captures report the fraction of clipped samples', () => {
  const context = vm.createContext({ performance });
  vm.runInContext(source + ';globalThis.clip = clippedFraction; globalThis.decode = decodeIQ;', context);
  const bytes8 = Uint8Array.from([127, 0, 0, 0, 0, 0x80, 1, 1]); // 4 samples: 2 at full scale
  assert.equal(context.clip(context.decode(bytes8, 4, 8), 8), 0.5);
  assert.equal(context.clip(context.decode(Uint8Array.from([5, 6, 7, 8]), 2, 8), 8), 0);
});
