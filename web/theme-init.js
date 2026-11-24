// Aplica o tema salvo antes da página aparecer (evita piscar claro/escuro). Script separado por causa da CSP.
(function () {
  try {
    var t = localStorage.getItem('cestimo:tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.dataset.theme = t === 'claro' ? 'light' : 'dark';
  } catch (e) { /* sem armazenamento: segue o sistema */ }
})();
