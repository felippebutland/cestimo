export function parseList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line === '') return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
