import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const connectionSource = await readFile(new URL('../serial-transport.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../radio.js', import.meta.url), 'utf8');
function makeRadio(timer = (f) => f()) {
  const context = vm.createContext({ performance, setTimeout: timer });
  vm.runInContext(connectionSource, context);
  vm.runInContext(source, context);
  return vm.runInContext('radio', context);
}
test('UART bridges exit reset and ROM download mode before synchronization', async () => {
  for (const vendor of [0x10c4, 0x1a86, 0x0403, 0x067b]) {
    const events = [];
    const r = makeRadio((f, ms) => {
      events.push(ms);
      f();
    });
    r.port = { getInfo: () => ({ usbVendorId: vendor }), setSignals: async (s) => events.push({ ...s }) };
    await r.startUartFirmware();
    assert.deepEqual(events, [
      { dataTerminalReady: false, requestToSend: true },
      100,
      { dataTerminalReady: false, requestToSend: false },
    ]);
  }
});
test('ESP32-S2 native USB lowers DTR before RTS so it reboots into the firmware', async () => {
  const events = [];
  const r = makeRadio((f, ms) => {
    events.push(ms);
    f();
  });
  r.port = {
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x0002 }),
    setSignals: async (s) => events.push({ ...s }),
  };
  await r.startUartFirmware();
  assert.deepEqual(events, [{ dataTerminalReady: false }, { requestToSend: false }, 200]);
});
test('native USB and unidentified ports do not receive UART reset signals', async () => {
  for (const info of [{ usbVendorId: 0x303a }, {}]) {
    const r = makeRadio();
    r.port = { getInfo: () => info, setSignals: () => assert.fail('unexpected UART reset') };
    await r.startUartFirmware();
  }
});
test('connect resets a UART bridge before sending the synchronization marker', async () => {
  const events = [];
  const port = {
    open: async () => events.push('open'),
    getInfo: () => ({ usbVendorId: 0x10c4 }),
    setSignals: async (s) => events.push(s.requestToSend ? 'reset' : 'run'),
    readable: { getReader: () => ({}) },
    writable: { getWriter: () => ({}) },
  };
  const context = vm.createContext({
    performance,
    setTimeout: (f) => f(),
    isSecureContext: true,
    navigator: { serial: { requestPort: async () => port } },
  });
  vm.runInContext(connectionSource, context);
  vm.runInContext(source, context);
  const r = vm.runInContext('radio', context);
  r.close = async () => {};
  r.pump = async () => {};
  r.synchronize = async () => {
    events.push('sync');
    assert.deepEqual(events, ['open', 'reset', 'run', 'sync']);
  };
  r.command = async () => {};
  const responses = [
    'ESP32SDR 6 burst 16380',
    'CAPS RXLIMITS',
    'LIMITS {"gain":[0,72,1],"bandwidth":[12,67,1,0],"rates":[80000000,40000000,16000000],"bits":[8,10]}',
  ];
  r.line = async () => responses.shift();
  assert.equal((await r.connect()).family, 'ESP32');
  assert.equal(responses.length, 0);
});
test('a serial break while the board resets does not end the connection', async () => {
  const r = makeRadio();
  const chunk = (text) => ({ value: new TextEncoder().encode(text), done: false });
  const breakError = Object.assign(new Error('Break received'), { name: 'BreakError' });
  const streams = [
    [chunk('boot'), breakError],
    [chunk('OK\n'), { done: true }],
  ];
  const reader = (steps) => ({
    read: async () => {
      const step = steps.shift();
      if (step instanceof Error) throw step;
      return step;
    },
    releaseLock: () => {},
  });
  r.port = { readable: { getReader: () => reader(streams.shift()) } };
  r.reader = r.port.readable.getReader();
  r.queue = [];
  r.queued = 0;
  await r.pump();
  assert.equal(new TextDecoder().decode(Buffer.concat(r.queue)), 'bootOK\n');
  assert.equal(r.failed.message, 'Device disconnected');

  const lost = makeRadio();
  const deviceLost = Object.assign(new Error('The device has been lost.'), { name: 'NetworkError' });
  lost.port = { readable: { getReader: () => assert.fail('no new reader after a fatal error') } };
  lost.reader = reader([deviceLost]);
  lost.queue = [];
  lost.queued = 0;
  await lost.pump();
  assert.equal(lost.failed, deviceLost);
});
