/**
 * Escapes characters for safe inclusion inside double-quoted YAML strings.
 * Also prevents GitHub Actions ${{ ... }} expression injection.
 */
export function escapeYamlDoubleQuote(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\${{/g, "${{ '${{' }}")
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Escapes single quotes for safe single-quoted YAML values.
 * Also prevents GitHub Actions expression injection and collapses multi-lines.
 */
export function escapeYamlSingleQuote(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/'/g, "''")
    .replace(/\${{/g, "${{ '${{' }}")
    .replace(/\r\n|\n|\r/g, ' ');
}

