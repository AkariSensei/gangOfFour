// Script à part (et non dans index.html) : la politique de sécurité du site interdit les scripts écrits dans la page.
// Pose le thème avant le premier affichage, pour éviter un flash de la mauvaise couleur.
(function () {
  var theme;
  try {
    theme = localStorage.getItem('gof-theme');
  } catch (e) {}
  if (theme !== 'dark' && theme !== 'light')
    theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  if (theme === 'dark') document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0b1812');
})();
