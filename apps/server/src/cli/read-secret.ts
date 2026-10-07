/** Reads one secret line from a TTY without echo, or the first line of piped standard input. Never an argument, never printed. */
export async function readSecretLine(prompt: string, forceStdin: boolean): Promise<string> {
  const stdin = process.stdin;
  if (!forceStdin && stdin.isTTY) {
    process.stderr.write(prompt);
    return new Promise<string>((resolve) => {
      let value = '';
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === '\r' || char === '\n') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stderr.write('\n');
            resolve(value);
            return;
          }
          if (char === '\u0003') {
            stdin.setRawMode(false);
            process.exit(130);
          }
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else if (char === '\u0004') {
            stdin.setRawMode(false);
            process.stderr.write('\n');
            process.exit(130);
          } else if (char >= ' ') value += char; // control characters and escape sequences are never part of the secret
        }
      };
      stdin.on('data', onData);
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const [first = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  return first;
}
