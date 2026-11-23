/* global window, document */
// Ritorno del login di LinkedIn e Instagram (che vogliono un indirizzo https) verso Prisma sul
// computer dell'utente: si passa la query (code, state, error) così com'è a 127.0.0.1, dove
// l'app ascolta solo durante l'uso. Nessuna richiesta verso altri server, nessun dato salvato.
(function () {
  var script = document.currentScript;
  var platform = script && script.getAttribute('data-platform');
  if (platform !== 'linkedin' && platform !== 'instagram') return;
  var target = 'http://127.0.0.1:47615/oauth/' + platform + '/callback' + window.location.search;
  var link = document.getElementById('link');
  if (link) link.setAttribute('href', target);
  window.setTimeout(function () {
    var manual = document.getElementById('manuale');
    if (manual) manual.hidden = false;
  }, 3000);
  window.location.replace(target);
})();
