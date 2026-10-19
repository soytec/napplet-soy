import { isIP } from 'node:net';

/** Applied by the operator before starting the dedicated Studio service user.
 * This is a kernel boundary for Git, DNS rebinding and every child process too.
 * Established replies permit loopback ingress, never a new loopback connection. */
export function studioEgress(uid: number, resolvers: string[]) {
  if (
    !Number.isSafeInteger(uid) ||
    uid < 100 ||
    !resolvers.length ||
    resolvers.some((r) => isIP(r) !== 4)
  )
    throw new Error(
      'A dedicated unprivileged Studio UID and explicit IPv4 DNS resolvers are required.',
    );
  return `table inet soy_studio {
 chain output {
  type filter hook output priority 0; policy accept;
  meta skuid ${uid} jump studio_only
 }
 chain studio_only {
  ct state established,related accept
  ip daddr 127.0.0.1 tcp dport 19351 accept
  ip daddr { ${[...new Set(resolvers)].join(', ')} } udp dport 53 accept
  ip daddr { ${[...new Set(resolvers)].join(', ')} } tcp dport 53 accept
  ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/3 } reject
  ip6 daddr != 2000::/3 reject
  ip6 daddr { 2001::/32, 2001:db8::/32, 2002::/16 } reject
  tcp dport 443 accept
  reject
 }
}
`;
}

if (import.meta.main) console.log(studioEgress(Number(process.argv[2]), process.argv.slice(3)));
