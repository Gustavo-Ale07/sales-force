import { Sha256 } from "./sha256";

const enc = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

describe("Sha256 (incremental)", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ])("matches the reference vector for %j", (input, expected) => {
    expect(new Sha256().update(enc(input)).digestHex()).toBe(expected);
  });

  it("gives the same digest for any chunking, including block-boundary sizes", () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 31 + 7) % 256);
    const expected = "5097e7d587352f5097062ae679f37bda5802d9f875aba14c8cb4d1a188ada179";
    for (const chunk of [1, 7, 55, 56, 63, 64, 65, 128, 999, 1000]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += chunk) h.update(data.subarray(i, i + chunk));
      expect(h.digestHex()).toBe(expected);
    }
  });

  it("hashes a 1 MiB input like node:crypto", () => {
    const data = new Uint8Array(1024 * 1024).map((_, i) => (i * 13) % 251);
    expect(new Sha256().update(data).digestHex()).toBe("8a60d7c2c106707ca42105493881468151316dc4bad4b2796b87f33694775ed6");
  });

  it("cannot be reused after the digest", () => {
    const h = new Sha256();
    h.digestHex();
    expect(() => h.update(enc("x"))).toThrow();
  });
});
