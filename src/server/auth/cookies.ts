/** Cookies sem biblioteca: só o que o login precisa. */

export const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => {
        const i = part.indexOf('=');
        const raw = part.slice(i + 1);
        let value = raw;
        try { value = decodeURIComponent(raw); } catch { /* valor inválido: fica como veio */ }
        return [part.slice(0, i), value] as const;
      }),
  );

/** Sempre HttpOnly (o JavaScript da página não lê) e SameSite=Lax (não vai em requisições de outros sites). */
export const serializeCookie = (name: string, value: string, opts: { maxAgeSec: number; secure: boolean }): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${opts.maxAgeSec}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
