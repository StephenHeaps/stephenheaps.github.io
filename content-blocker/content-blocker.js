// Shared by test.html (top frame) and frame.html (cross-site iframe).
// Uses <script> loads so only content blocker rules apply; iOS's JS request
// blocking only wraps fetch/XHR.
(function () {
  const ORIGINS = [
    'https://stephenheaps.com',
    'https://stephenheaps-testing.stephenheaps.workers.dev',
  ];

  function otherOrigin() {
    const param = new URLSearchParams(location.search).get('other');
    if (param) {
      return new URL(param).origin;
    }
    return ORIGINS.find(origin => origin !== location.origin);
  }

  function scriptURL(origin) {
    return origin + '/content-blocker/script.js';
  }

  function loadScript(url) {
    return new Promise(resolve => {
      const script = document.createElement('script');
      const timer = setTimeout(() => resolve('no response'), 5000);
      script.onload = () => {
        clearTimeout(timer);
        resolve('loaded');
      };
      script.onerror = () => {
        clearTimeout(timer);
        resolve('blocked');
      };
      script.src = url + '?cb=' + Date.now() + Math.random();
      document.head.appendChild(script);
    });
  }

  // Loads script.js from this frame's own domain (first party) and from the
  // other domain (third party).
  async function runChecks() {
    const [firstParty, thirdParty] = await Promise.all([
      loadScript(scriptURL(location.origin)),
      loadScript(scriptURL(otherOrigin())),
    ]);
    return { frameOrigin: location.origin, firstParty, thirdParty };
  }

  self.ContentBlockerTest = { ORIGINS, otherOrigin, runChecks };
})();
