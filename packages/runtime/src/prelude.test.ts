import { expect, test } from 'bun:test';
import { WEBRTC_REMOVAL, nappletPrelude } from './prelude';

test('interim WebRTC removal pins every RTC global and vendor alias as undefined', () => {
  const realm: Record<string, unknown> = {
    RTCPeerConnection: class {},
    RTCDataChannel: class {},
    RTCSessionDescription: class {},
    RTCIceCandidate: class {},
    webkitRTCPeerConnection: class {},
    MessageChannel: class {},
  };
  new Function('globalThis', WEBRTC_REMOVAL)(realm);
  for (const name of [
    'RTCPeerConnection',
    'RTCDataChannel',
    'RTCSessionDescription',
    'RTCIceCandidate',
    'webkitRTCPeerConnection',
    'mozRTCPeerConnection',
    'mozRTCIceCandidate',
  ]) {
    expect(realm[name]).toBeUndefined();
    const descriptor = Object.getOwnPropertyDescriptor(realm, name)!;
    expect(descriptor.writable).toBe(false);
    expect(descriptor.configurable).toBe(false);
    expect(() => {
      'use strict';
      realm[name] = class {};
    }).toThrow();
    expect(Reflect.deleteProperty(realm, name)).toBe(false);
  }
  expect(realm.MessageChannel).toBeFunction();
});

test('the bootstrap removes WebRTC first and leaves all messaging, including SHELL, to the port shim', () => {
  const prelude = nappletPrelude('/*shim*/');
  expect(prelude.indexOf(WEBRTC_REMOVAL)).toBe(0);
  expect(prelude.indexOf('/*shim*/')).toBeGreaterThan(WEBRTC_REMOVAL.length - 1);
  const install = /NappletShimPrelude\.install\((.*)\);/.exec(prelude)![1];
  expect(JSON.parse(install).domains).toContain('shell');
  expect(prelude).not.toContain('postMessage');
  expect(prelude).not.toContain("addEventListener('message'");
});
