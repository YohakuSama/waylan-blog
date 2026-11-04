try{var theme=JSON.parse(localStorage.getItem('echo:theme')||'null');document.documentElement.dataset.theme=theme==='light'||theme==='dark'?theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{document.documentElement.dataset.theme='light';}
try{var motion=JSON.parse(localStorage.getItem('echo:motion')||'null');motion=motion==='full'||motion==='reduced'||motion==='system'?motion:'system';document.documentElement.dataset.motionPreference=motion;document.documentElement.dataset.motion=motion==='reduced'||motion==='system'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';}catch{document.documentElement.dataset.motionPreference='system';document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';}
try{var skin=JSON.parse(localStorage.getItem('echo:skin')||'null');document.documentElement.dataset.skin=skin==='terminal'?'terminal':'editorial';}catch{document.documentElement.dataset.skin='editorial';}
(function(){try{var d=document.documentElement.dataset,m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d.skin==='terminal'?(d.theme==='dark'?'#0b0d0c':'#eef0e8'):(d.theme==='dark'?'#16151a':'#f7f4ee');}catch(e){}})();
// Pages are already prerendered as readable HTML, with their visible fonts
// preloaded. Never hide #root while waiting for document.fonts.ready: on iOS
// Safari every reload would flash a full-screen W mask, including beneath the
// translucent bottom browser toolbar. The boot node is inert and can be removed
// once the document has been parsed.
(function () {
  var root = document.documentElement;
  root.classList.remove("font-wait", "font-loader", "font-loader-out");
  function removeBoot() {
    var boot = document.getElementById("boot");
    if (boot) boot.remove();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", removeBoot, { once: true });
  else removeBoot();
})();
