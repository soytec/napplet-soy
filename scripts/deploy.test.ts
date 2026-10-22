import { expect, test } from 'bun:test';
import {
  validateBlossomDomain,
  validateGitDomain,
  validateTarget,
  validateWebPort,
  validateRelayDomain,
} from './deploy';
import { sharedCaddyCandidate } from './shared-caddy';
test('relay defaults to its own hostname and cannot replace another site', () => {
  expect(validateRelayDomain('napplet.example', 'files.example', 'git.example')).toBe(
    'relay.napplet.example',
  );
  for (const value of [
    'napplet.example',
    'www.napplet.example',
    'files.example',
    'git.example',
    'wss://relay.example',
    'x.example;id',
  ])
    expect(() =>
      validateRelayDomain('napplet.example', 'files.example', 'git.example', value),
    ).toThrow();
});
test('shared deployment preserves existing configuration and updates only its own import', () => {
  const original =
    '{\n email admin@example.com\n}\nexisting.example {\n reverse_proxy localhost:3000\n}\n';
  const fragment = '/etc/napplet-space/Caddyfile';
  const first = sharedCaddyCandidate(original, fragment, fragment);
  expect(first.startsWith(original)).toBe(true);
  expect(sharedCaddyCandidate(first, fragment, fragment)).toBe(first);
  const candidate = sharedCaddyCandidate(
    first,
    fragment,
    '/opt/napplet-space/shared/Caddyfile.next',
  );
  expect(candidate.startsWith(original)).toBe(true);
  expect(candidate).toContain('import /opt/napplet-space/shared/Caddyfile.next');
  expect(() => sharedCaddyCandidate(`${first}\nimport ${fragment}`, fragment, fragment)).toThrow(
    'Duplicate',
  );
});
test('application ports reserve a separate smoke port and cannot collide with native services', () => {
  expect(validateWebPort('3040')).toBe(3040);
  for (const value of [
    '80',
    '0',
    '65535',
    '19346',
    '19347',
    '19348',
    '19349',
    '19350',
    '19351',
    '19352',
    '3477',
    '3478',
    '3000;id',
    '-1',
  ])
    expect(() => validateWebPort(value)).toThrow();
});
test('deployment accepts explicit SSH targets and DNS domains', () => {
  expect(validateTarget('root@203.0.113.10', 'napplet.example')).toEqual({
    host: 'root@203.0.113.10',
    domain: 'napplet.example',
  });
  expect(validateTarget('my-vps', 'demo.napplet.example').host).toBe('my-vps');
});
test('deployment rejects shell injection, missing targets, and URL-shaped domains', () => {
  for (const host of [
    undefined,
    '-oProxyCommand=bad',
    'host;whoami',
    'user@host$(id)',
    'user@host bad',
  ])
    expect(() => validateTarget(host, 'napplet.example')).toThrow();
  for (const domain of [
    undefined,
    'https://napplet.example',
    'napplet.example/path',
    'x.example\nreverse_proxy evil',
    '*.example',
  ])
    expect(() => validateTarget('my-vps', domain)).toThrow();
});
test('Blossom deploys on a separate validated hostname', () => {
  expect(validateBlossomDomain('napplet.example')).toBe('blossom.napplet.example');
  expect(validateBlossomDomain('napplet.example', 'files.example')).toBe('files.example');
  for (const value of [
    'napplet.example',
    'x.example;whoami',
    'https://files.example',
    'x.example\nreverse_proxy evil',
    '*.example',
  ])
    expect(() => validateBlossomDomain('napplet.example', value)).toThrow();
});
test('GRASP requires a third validated root hostname', () => {
  expect(validateGitDomain('napplet.example', 'blossom.napplet.example')).toBe(
    'git.napplet.example',
  );
  expect(validateGitDomain('napplet.example', 'files.example', 'source.example')).toBe(
    'source.example',
  );
  for (const value of [
    'napplet.example',
    'files.example',
    'https://source.example',
    'x.example;id',
    '*.example',
  ])
    expect(() => validateGitDomain('napplet.example', 'files.example', value)).toThrow();
});
