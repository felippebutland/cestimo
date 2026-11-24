/** Janelas do próprio app (no lugar de prompt/confirm do navegador): pedir um texto e confirmar uma ação. */

export function validateName(raw, max) {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: false, error: 'Digite um nome.' };
  if (value.length > max) return { ok: false, error: `Use até ${max} letras.` };
  return { ok: true, value };
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};

/** Abre um <dialog> modal e devolve a resposta quando a pessoa fecha (botão, Enter, Esc ou toque fora). */
function open(build) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'swap-dialog modal' });
    let answer = null;
    const close = (value) => { answer = value; dialog.close(); };
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(null); });
    dialog.append(...build(close));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Pede um nome. Devolve o texto limpo ou null se cancelar.
 * @param {{ title: string, label?: string, value?: string, confirmLabel?: string, max?: number }} o
 */
export function askText({ title, label = 'Nome', value = '', confirmLabel = 'Salvar', max = 40 }) {
  return open((close) => {
    const input = el('input', { type: 'text', className: 'modal-input', value, maxLength: max + 20, autocomplete: 'off', id: 'modal-input' });
    const error = el('p', { className: 'modal-error', role: 'alert' });
    const submit = () => {
      const r = validateName(input.value, max);
      if (!r.ok) { error.textContent = r.error; input.focus(); return; }
      close(r.value);
    };
    const form = el('form', { className: 'modal-form' },
      el('label', { htmlFor: 'modal-input', className: 'modal-label', textContent: label }), input, error,
      el('div', { className: 'dialog-actions' },
        el('button', { type: 'button', className: 'btn', textContent: 'Cancelar', onclick: () => close(null) }),
        el('button', { type: 'submit', className: 'btn brand', textContent: confirmLabel })));
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return [el('h3', { textContent: title }), form];
  });
}

/**
 * Pede confirmação. Devolve true ou false.
 * @param {{ title: string, message: string, confirmLabel?: string, danger?: boolean }} o
 */
export async function askConfirm({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  const answer = await open((close) => {
    const ok = el('button', { type: 'button', className: `btn ${danger ? 'danger-btn' : 'brand'}`, textContent: confirmLabel, onclick: () => close(true) });
    setTimeout(() => ok.focus(), 0);
    return [
      el('h3', { textContent: title }),
      el('p', { className: 'muted-note', textContent: message }),
      el('div', { className: 'dialog-actions' }, el('button', { type: 'button', className: 'btn', textContent: 'Cancelar', onclick: () => close(false) }), ok),
    ];
  });
  return answer === true;
}
