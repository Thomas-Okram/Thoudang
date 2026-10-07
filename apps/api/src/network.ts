import os from 'node:os';

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * Private IPv4 addresses of this machine, best first: Wi-Fi/Ethernet (en*, wlan*, eth*) before
 * virtual adapters. On a phone hotspot this is typically 172.20.10.x (iPhone) or 192.168.43.x (Android).
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const found: { ip: string; score: number }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || !PRIVATE.some((r) => r.test(info.address))) {
        continue;
      }
      const physical = /^(en|eth|wlan|wl|Wi-?Fi|Ethernet)/i.test(name) ? 0 : 10;
      const virtual = /(vbox|vmnet|docker|br-|utun|bridge|veth|tailscale|zt)/i.test(name) ? 100 : 0;
      found.push({ ip: info.address, score: physical + virtual });
    }
  }
  return found.sort((a, b) => a.score - b.score).map((f) => f.ip);
}
