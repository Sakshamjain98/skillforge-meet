import { Device } from 'mediasoup-client';

/**
 * Lazily-created mediasoup Device singleton.
 *
 * The Device must be recreated for each conference session because
 * it is bound to a specific Router's RTP capabilities.
 * Call resetDevice() on leave, then getDevice() on next join.
 */
let device: Device | null = null;

export function getDevice(): Device {
  if (!device) {
    device = new Device();
  }
  return device;
}

export function resetDevice(): void {
  device = null;
}

export function isDeviceLoaded(): boolean {
  return !!device?.loaded;
}