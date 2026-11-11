// Builds the test iframes for the current page. Each frame runs probe.js and
// reports its results to this page.
(function () {
  const CASES = [
    {
      name: 'sandbox',
      description: 'sandbox="allow-scripts" srcdoc. Opaque origin.',
      sandbox: 'allow-scripts',
    },
    {
      name: 'data-url',
      description: 'data: URL iframe. Opaque origin.',
      dataURL: true,
    },
    {
      name: 'sandbox-same-origin',
      description: 'sandbox="allow-scripts allow-same-origin" srcdoc. Control: inherits the creating origin.',
      sandbox: 'allow-scripts allow-same-origin',
    },
    {
      name: 'srcdoc',
      description: 'Plain srcdoc iframe. Control: inherits the creating origin.',
    },
  ];

  function frameDocument(config, probeSource) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
      '<body style="font-family:-apple-system,sans-serif;font-size:12px">' +
      '<script>self.PROBE_CONFIG = ' + JSON.stringify(config) + ';\n' +
      probeSource + '<\/script></body></html>';
  }

  async function buildFrames(container, config, prefix) {
    const probeSource = await fetch('probe.js', { cache: 'no-store' }).then(r => r.text());
    const frameConfig = { mainOrigin: config.mainOrigin, initiatorOrigin: config.initiatorOrigin };
    for (const c of CASES) {
      const section = document.createElement('div');
      section.className = 'case';
      const title = document.createElement('h3');
      title.textContent = prefix + c.name;
      const desc = document.createElement('p');
      desc.textContent = c.description;
      section.appendChild(title);
      section.appendChild(desc);

      const iframe = document.createElement('iframe');
      iframe.name = prefix + c.name;
      if (c.sandbox !== undefined) {
        iframe.setAttribute('sandbox', c.sandbox);
      }
      const html = frameDocument({ ...frameConfig, caseName: iframe.name }, probeSource);
      if (c.dataURL) {
        iframe.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      } else {
        iframe.srcdoc = html;
      }
      section.appendChild(iframe);
      container.appendChild(section);
    }
  }

  self.ProbeHarness = { CASES, buildFrames };
})();
