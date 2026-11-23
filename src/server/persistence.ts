import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Arquivo JSON de estado. Gravação atômica (arquivo temporário + rename); falhas nunca derrubam o app. */
export function createStateFile(path: string) {
  return {
    load(): unknown | null {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(state: unknown): boolean {
      try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(state));
        renameSync(tmp, path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Executa `save` a cada `intervalMs`. O `stop()` faz uma última gravação. */
export function startAutosave(save: () => void, intervalMs: number): () => void {
  const timer = setInterval(save, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    save();
  };
}
