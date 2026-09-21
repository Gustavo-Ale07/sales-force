import { isIPv4, isIPv6 } from 'node:net';

/** Eight 16-bit groups of an IPv6 address, or `null` when the text is not a valid address. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded?.[1] !== undefined) {
    const octets = embedded[1].split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, -embedded[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const [head = '', tail] = parts;
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  let groups: string[];
  if (tail === undefined) {
    groups = front;
  } else {
    const missing = 8 - front.length - back.length;
    if (missing < 1) return null;
    groups = [...front, ...Array<string>(missing).fill('0'), ...back];
  }
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * The address a login throttle counts against. IPv4: the address. IPv4-mapped IPv6: the IPv4
 * address. Any other IPv6: its /64 (`<first four groups>::/64`), because one subscriber normally
 * holds a whole /64 and could otherwise rotate through 2^64 addresses to dodge the per-address
 * limit. Anything else is truncated so a key can never grow without bound.
 */
export function throttleAddress(ip: string): string {
  const text = (ip.trim().toLowerCase().split('%')[0] ?? '').trim();
  if (isIPv4(text)) return text;
  if (!isIPv6(text)) return text.slice(0, 64);
  const groups = ipv6Groups(text);
  if (groups === null) return text.slice(0, 64);
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  return `${[g0, g1, g2, g3].map((group) => group.toString(16)).join(':')}::/64`;
}
