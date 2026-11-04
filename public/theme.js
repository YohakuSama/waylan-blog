try{var theme=JSON.parse(localStorage.getItem('echo:theme')||'null');document.documentElement.dataset.theme=theme==='light'||theme==='dark'?theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{document.documentElement.dataset.theme='light';}
try{var motion=JSON.parse(localStorage.getItem('echo:motion')||'null');motion=motion==='full'||motion==='reduced'||motion==='system'?motion:'system';document.documentElement.dataset.motionPreference=motion;document.documentElement.dataset.motion=motion==='reduced'||motion==='system'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';}catch{document.documentElement.dataset.motionPreference='system';document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';}
try{var skin=JSON.parse(localStorage.getItem('echo:skin')||'null');document.documentElement.dataset.skin=skin==='terminal'?'terminal':'editorial';}catch{document.documentElement.dataset.skin='editorial';}
(function(){try{var d=document.documentElement.dataset,m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d.skin==='terminal'?(d.theme==='dark'?'#0b0d0c':'#eef0e8'):(d.theme==='dark'?'#16151a':'#f7f4ee');}catch(e){}})();
// Wait only for the fonts used on the initial document. Fast cached loads do not
// flash a loader; slow fonts show a legible progress mark with an absolute cap.
(function () {
  var root = document.documentElement;
  var fonts = document.fonts;
  if (!fonts || !fonts.ready || !window.requestAnimationFrame) return;
  var started = performance.now();
  var done = false;
  var timeout;
  root.classList.add("font-wait", "font-loader");
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    root.classList.remove("font-wait");
    root.classList.add("font-loader-out");
    setTimeout(function () {
      root.classList.remove("font-loader", "font-loader-out");
      var boot = document.getElementById("boot");
      if (boot) boot.remove();
    }, 420);
  }
  function ready() {
    var age = performance.now() - started;
    // A loader that has become visible must not disappear mid-fade.
    if (age >= 160 && age < 400) setTimeout(finish, 400 - age);
    else finish();
  }
  function waitForFonts() { fonts.ready.then(ready, ready); }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", waitForFonts, { once: true });
  else waitForFonts();
  timeout = setTimeout(finish, location.protocol === "file:" ? 3200 : 2400);
})();
