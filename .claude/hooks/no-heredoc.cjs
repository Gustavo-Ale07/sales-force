// PreToolUse hook (Bash): blocks heredocs and here-strings. Write the content to a file with the Write tool instead.
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let command = '';
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    command = String(input?.tool_input?.command ?? '');
  } catch {
    process.exit(0);
  }
  if (/<<<?-?\s*['"]?[A-Za-z_]/.test(command)) {
    process.stderr.write(
      'BLOQUEADO: heredoc/herestring não é permitido neste repositório; escreva o conteúdo num arquivo com a ferramenta Write e passe o caminho\n',
    );
    process.exit(2);
  }
  process.exit(0);
});
