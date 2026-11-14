// Meta's Immersive Web Emulator. Open the app with ?emu to get a fake Quest 3
// with tracked hands right in your laptop browser. Perfect for building and for
// recording the demo video with no headset.

import { XRDevice, metaQuest3 } from 'iwer';
import { DevUI } from '@iwer/devui';
import { SyntheticEnvironmentModule } from '@iwer/sem';

export function installEmulator() {
  const device = new XRDevice(metaQuest3);
  device.primaryInputMode = 'hand';
  device.stereoEnabled = false;
  device.installRuntime({ forceInstall: true });
  // Seated eye height, looking at the desk.
  device.position.set(0, 1.2, 0.05);
  device.quaternion.set(-0.2, 0, 0, 0.98); // look slightly down at the desk
  // A synthetic room for passthrough: real looking walls, floor and a desk with detected planes,
  // so "Enter passthrough" snaps the HQ onto the desk just like on a Quest 3. Pick with ?room=kitchen etc.
  try {
    device.installSEM(SyntheticEnvironmentModule);
    const room = new URLSearchParams(location.search).get('room') || 'home_office';
    device.sem.loadDefaultEnvironment(room).catch(e => console.warn('room failed to load', e));
    // Sit at the desk in the home office, like a real seated session.
    if (room === 'home_office') device.position.set(0, 1.15, -1.2);
  } catch (e) { console.warn('synthetic environment not available', e); }
  // eslint-disable-next-line no-new
  new DevUI(device);
  window.__xrDevice = device;
  return device;
}
