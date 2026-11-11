// Shared by test.html (top frame) and frame.html (cross-site iframe).
// Uses <script> loads so only network-level (content blocker) rules apply;
// iOS's JS request blocking only wraps fetch/XHR.
(function () {
  const ORIGINS = [
    'https://stephenheaps.com',
    'https://stephenheaps-testing.stephenheaps.workers.dev',
  ];
  const FILES = ['cb-any.js', 'cb-3p.js'];

  function otherOrigin() {
    const param = new URLSearchParams(location.search).get('other');
    if (param) {
      return new URL(param).origin;
    }
    return ORIGINS.find(origin => origin !== location.origin);
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

  function targets() {
    const origins = [...new Set([...ORIGINS, location.origin, otherOrigin()])];
    const list = [];
    for (const origin of origins) {
      for (const file of FILES) {
        list.push({ origin, file, url: origin + '/content-blocker/' + file });
      }
    }
    return list;
  }

  async function runChecks() {
    const list = targets();
    const results = await Promise.all(list.map(target => loadScript(target.url)));
    return {
      frameOrigin: location.origin,
      results: list.map((target, i) => ({ ...target, result: results[i] })),
    };
  }

  function filters() {
    return targets().map(({ origin, file }) => {
      const rule = '||' + new URL(origin).host + '/content-blocker/' + file + '^';
      return file === 'cb-3p.js' ? rule + '$third-party' : rule;
    });
  }

  self.ContentBlockerTest = { otherOrigin, runChecks, targets, filters };
})();
