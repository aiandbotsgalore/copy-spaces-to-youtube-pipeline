/**
 * Escapes characters for safe inclusion inside double-quoted YAML strings.
 */
export function escapeYamlDoubleQuote(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Escapes single quotes for safe single-quoted YAML values.
 */
export function escapeYamlSingleQuote(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/'/g, "''");
}
