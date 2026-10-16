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
  assert.match(s31.frequencyWarning(2200), /PLL may not lock/); // not measured: generic text
});
