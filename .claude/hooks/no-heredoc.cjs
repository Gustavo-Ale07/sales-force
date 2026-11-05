// PreToolUse hook (Bash): blocks heredocs and here-strings. Write the content to a file with the Write tool instead.
// Exit codes: 2 = heredoc found (blocked); 0 in every other case, including any internal error (never exit 1).
try {
  const chunks = [];
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const command = String(input?.tool_input?.command ?? '');
      if (/<<<?-?\s*['"]?[A-Za-z_]/.test(command)) {
        process.stderr.write(
          'BLOQUEADO: heredoc/herestring não é permitido neste repositório; escreva o conteúdo num arquivo com a ferramenta Write e passe o caminho\n',
        );
        process.exit(2);
      }
    } catch {
      // internal error: never block
    }
    process.exit(0);
  });
} catch {
  process.exit(0);
}
