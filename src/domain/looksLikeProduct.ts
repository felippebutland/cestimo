/**
 * Triagem barata de "isto parece o nome de um produto?". Não tenta adivinhar o que é produto: recusa só o que é
 * claramente outra coisa (programação, pergunta em inglês, código, link, tentativa de instrução). Na dúvida, passa.
 */

const MAX_WORDS = 12;
const MAX_LENGTH = 100;

const strip = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Palavras de programação e de "converse comigo". Nenhuma delas aparece em nome de produto de mercado ou farmácia. */
const OFF_TOPIC = new Set([
  'language', 'code', 'coding', 'program', 'programming', 'programacao', 'programar', 'algoritmo', 'algorithm', 'function', 'funcao', 'script',
  'quicksort', 'mergesort', 'bubblesort', 'javascript', 'typescript', 'python', 'java', 'golang', 'rust', 'kotlin', 'php', 'html', 'css', 'sql',
  'react', 'angular', 'nodejs', 'compilador', 'compiler', 'debug', 'stackoverflow', 'github', 'chatgpt', 'gpt', 'prompt', 'api', 'json', 'regex',
  'ignore', 'ignorar', 'instructions', 'instrucoes', 'jailbreak',
]);

/** Palavras funcionais do inglês: uma só já mostra que a frase não é em português. "in" fica de fora (vale em "in natura"). */
const ENGLISH = new Set(['the', 'how', 'what', 'why', 'who', 'when', 'where', 'write', 'create', 'explain', 'make', 'build', 'show', 'tell', 'give', 'please', 'is', 'are', 'my', 'you', 'your', 'with', 'for', 'to', 'of', 'and', 'from']);

const SQL = /\b(select|insert|delete|drop|update|union)\b.*\b(from|into|table|set|select)\b/i;
const CODE_CHARS = /[<>{}[\]\\|`;=$]|\/\/|:\/\/|\(\)/;

export function looksLikeProduct(query: string): boolean {
  const q = query.trim();
  if (q === '' || q.length > MAX_LENGTH) return false;
  if (!/\p{L}/u.test(q)) return false;
  if (CODE_CHARS.test(q) || SQL.test(q)) return false;
  const words = strip(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length > MAX_WORDS) return false;
  if (words.some((w) => OFF_TOPIC.has(w))) return false;
  const english = words.filter((w) => ENGLISH.has(w)).length;
  // "and"/"to"/"for"/"of" soltos são raros em português; duas palavras do inglês ou uma pergunta (how, what…) já bastam
  if (english >= 2 || words.some((w) => ['how', 'what', 'why', 'who', 'when', 'where', 'write', 'create', 'explain', 'please', 'the'].includes(w))) return false;
  return true;
}
