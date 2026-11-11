// Runs Shields checks in the current frame and reports them to the parent frame
// (or the current window when top level). Expects `self.PROBE_CONFIG`:
// { mainOrigin, initiatorOrigin, caseName }.
(function () {
  const config = self.PROBE_CONFIG;
  const caseName = window.name || config.caseName;

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }

  function canvasProbe() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '16px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(10, 10, 100, 30);
      ctx.fillStyle = '#069';
      ctx.fillText('Brave farbling', 4, 15);
      return hash(canvas.toDataURL());
    } catch (e) {
      return 'error: ' + e.message;
    }
  }

  function audioProbe() {
    try {
      const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new AudioCtx(1, 4410, 44100);
      const buffer = ctx.createBuffer(1, 4410, 44100);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin(i / 10);
      }
      let sum = 0;
      for (const v of buffer.getChannelData(0)) {
        sum += Math.abs(v);
      }
      return sum.toFixed(6);
    } catch (e) {
      return 'error: ' + e.message;
    }
  }

  function scriptletProbe() {
    const applied = [];
    if (window.braveOpaqueScriptletMain === true) {
      applied.push('main');
    }
    if (window.braveOpaqueScriptletInitiator === true) {
      applied.push('initiator');
    }
    return applied.length ? applied.join(', ') : 'none';
  }

  function cosmeticProbe() {
    const variants = ['generic', 'main', 'initiator'];
    const container = document.createElement('div');
    for (const variant of variants) {
      const el = document.createElement('div');
      el.className = 'brave-opaque-' + variant;
      el.dataset.variant = variant;
      el.textContent = el.className;
      el.style.height = '1px';
      container.appendChild(el);
    }
    document.body.appendChild(container);
    return new Promise(resolve => {
      setTimeout(() => {
        const hidden = Array.from(container.children)
          .filter(el => getComputedStyle(el).display === 'none' || el.offsetHeight === 0)
          .map(el => el.dataset.variant);
        container.remove();
        resolve(hidden.length ? hidden.join(', ') : 'none');
      }, 2000);
    });
  }

  // `asURL` passes a URL object, which iOS's JS request blocking wrapper
  // forwards untouched, so only network-level (content blocker) rules apply.
  function fetchProbe(url, asURL) {
    const target = url + '?cb=' + Date.now() + Math.random();
    const timeout = new Promise(resolve => setTimeout(() => resolve('no response'), 5000));
    const request = fetch(asURL ? new URL(target) : target, { mode: 'no-cors', cache: 'no-store' })
      .then(() => 'loaded')
      .catch(() => 'blocked');
    return Promise.race([request, timeout]);
  }

  function requestProbe(asURL) {
    const probes = [
      ['any', config.mainOrigin + '/opaque-origin/brave-opaque-any.txt'],
      ['3p-main', config.mainOrigin + '/opaque-origin/brave-opaque-3p.txt'],
    ];
    if (config.initiatorOrigin) {
      probes.push(['3p-initiator', config.initiatorOrigin + '/opaque-origin/brave-opaque-initiator-3p.txt']);
    }
    return Promise.all(probes.map(([, url]) => fetchProbe(url, asURL))).then(results =>
      probes.map(([label], i) => label + ': ' + results[i]).join(', '));
  }

  function report(result) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'probe-result', result }, '*');
    } else {
      window.dispatchEvent(new CustomEvent('probe-result', { detail: result }));
    }
  }

  async function run() {
    const [cosmetic, request, network] = await Promise.all([
      cosmeticProbe(),
      requestProbe(false),
      requestProbe(true),
    ]);
    report({
      caseName,
      origin: window.origin,
      canvas: canvasProbe(),
      audio: audioProbe(),
      hardwareConcurrency: String(navigator.hardwareConcurrency),
      scriptlet: scriptletProbe(),
      cosmetic,
      request,
      network,
    });
  }

  if (document.body) {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})();
