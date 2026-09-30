/**
 * Merge one stdio MCP server into mcp.json text for the Settings add form.
 * Invalid existing JSON starts from an empty `{ servers: {} }` shell.
 */
export function mergeMcpServerEntry(
  text: string,
  name: string,
  command: string,
  args: readonly string[],
): string {
  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  if (!trimmedName || !trimmedCommand) {
    return text;
  }
  let servers: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text || '{"servers":{}}') as { servers?: unknown };
    if (parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)) {
      servers = { ...(parsed.servers as Record<string, unknown>) };
    }
  } catch {
    servers = {};
  }
  const entry: Record<string, unknown> = { command: trimmedCommand };
  if (args.length > 0) entry.args = [...args];
  servers[trimmedName] = entry;
  return `${JSON.stringify({ servers }, null, 2)}\n`;
}
