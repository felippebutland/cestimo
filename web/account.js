/** Conta do usuário (login com Google): o que o cabeçalho mostra. */

export const firstName = (name) => name.trim().split(/\s+/)[0] || 'Você';

export const accountView = ({ authEnabled, user }) => {
  if (!authEnabled) return { mode: 'hidden' };
  if (!user) return { mode: 'login', label: 'Entrar com Google' };
  return { mode: 'user', label: firstName(user.name) };
};

export const loginFailed = (search) => new URLSearchParams(search).get('login') === 'erro';
