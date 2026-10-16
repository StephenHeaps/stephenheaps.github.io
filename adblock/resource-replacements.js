const BASE = 'https://httpbin.org/anything'
const HB = 'https://httpbin.org'
const CDN = 'https://cdn.jsdelivr.net/npm'
// Unique query per run so the page script's per-URL cache doesn't hide changes.
const nonce = () => `n=${Date.now()}${Math.random().toString(36).slice(2, 6)}`

const fetchText = async (url) => {
  try {
    const r = await fetch(url)
    return { ok: true, body: await r.text() }
  } catch (e) {
    return { ok: false, body: String(e) }
  }
}

const xhrText = (url) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.setRequestHeader('X-Test-Header', 'kept')
    xhr.onload = () => resolve({ ok: true, body: xhr.responseText })
    xhr.onerror = () => resolve({ ok: false, body: 'error event' })
    xhr.send()
  })

// Element loads bypass fetch/XHR, so only the content blocker can act on them.
const loadElement = (tag, url) =>
  new Promise((resolve) => {
    const el = document.createElement(tag)
    let settled = false
    const done = (ok, body) => {
      if (settled) return
      settled = true
      resolve({ ok, body: `${body}: ${url}`, el })
      el.remove()
    }
    el.onload = () => done(true, 'load event')
    el.onerror = () => done(false, 'error event')
    setTimeout(() => done(false, 'timeout'), 10000)
    if (tag === 'link') {
      el.rel = 'stylesheet'
      el.href = url
    } else {
      el.src = url
    }
    document.body.appendChild(el)
  })

// Distinguishes redirected / blocked / original for $redirect rules.
const outcome = (r, isOriginal) =>
  !r.ok ? 'blocked' : isOriginal ? 'loaded original' : 'redirected'

const parseJSON = (body) => {
  try { return JSON.parse(body) } catch { return null }
}

const paramStripped = (r) => {
  const a = parseJSON(r.body)?.args
  return r.ok && !!a && a.keep === '1' && !('utm_source' in a)
}

const tests = [
  {
    name: 'fetch: control (not filtered)',
    expected: 'Loads normally, httpbin JSON',
    run: () => fetchText(`${BASE}/control?${nonce()}`),
    check: (r) => r.ok && !!parseJSON(r.body)?.url?.includes('/control'),
  },
  {
    name: 'fetch: blocked',
    expected: 'Rejects with TypeError',
    run: () => fetchText(`${BASE}/block-me?${nonce()}`),
    check: (r) => !r.ok,
  },
  {
    name: 'xhr: blocked',
    expected: 'error event',
    run: () => xhrText(`${BASE}/block-me?${nonce()}`),
    check: (r) => !r.ok,
  },
  {
    name: 'fetch: redirect (noop.json)',
    expected: 'Body is {} (redirect resource), not httpbin JSON',
    run: () => fetchText(`${BASE}/redirect-me?${nonce()}`),
    check: (r) => r.ok && r.body.trim() === '{}',
  },
  {
    name: 'xhr: redirect (noop.json)',
    expected: 'Body is {} (redirect resource)',
    run: () => xhrText(`${BASE}/redirect-me?${nonce()}`),
    check: (r) => r.ok && r.body.trim() === '{}',
  },
  {
    name: 'fetch: removeparam utm_source',
    expected: 'args has keep, no utm_source',
    run: () => fetchText(`${BASE}/rewrite?utm_source=test&keep=1&${nonce()}`),
    check: paramStripped,
  },
  {
    name: 'fetch(Request): removeparam utm_source',
    expected: 'args has keep, no utm_source',
    run: () => fetchText(new Request(`${BASE}/rewrite?utm_source=test&keep=1&${nonce()}`)),
    check: paramStripped,
  },
  {
    name: 'xhr: removeparam utm_source + header replay',
    expected: 'No utm_source, X-Test-Header still sent',
    run: () => xhrText(`${BASE}/rewrite?utm_source=test&keep=1&${nonce()}`),
    check: (r) =>
      paramStripped(r) && parseJSON(r.body)?.headers?.['X-Test-Header'] === 'kept',
  },
  {
    name: '<img>: control',
    expected: 'load event',
    run: () => loadElement('img', `${HB}/image/png?${nonce()}`),
    check: (r) => r.ok,
  },
  {
    name: '<img>: blocked',
    expected: 'error event',
    run: () => loadElement('img', `${HB}/image/jpeg?${nonce()}`),
    check: (r) => !r.ok,
  },
  {
    name: '<img>: redirect (1x1.gif)',
    expected: 'redirected (1x1 image)',
    run: async () => {
      const r = await loadElement('img', `${HB}/image/webp?${nonce()}`)
      const res = outcome(r, r.ok && r.el.naturalWidth !== 1)
      return { ...r, body: `${res} (${r.el.naturalWidth}x${r.el.naturalHeight})\n${r.body}` }
    },
    check: (r) => r.body.startsWith('redirected'),
  },
  {
    name: '<script>: control',
    expected: 'load event',
    run: () => loadElement('script', `${CDN}/lodash@4.17.21/lodash.min.js?${nonce()}`),
    check: (r) => r.ok,
  },
  {
    name: '<script>: blocked',
    expected: 'error event',
    run: () => loadElement('script', `${CDN}/underscore@1.13.6/underscore-min.js?${nonce()}`),
    check: (r) => !r.ok,
  },
  {
    name: '<script>: redirect (noopjs)',
    expected: 'redirected (load event, jQuery not defined)',
    run: async () => {
      delete window.jQuery
      delete window.$
      const r = await loadElement('script', `${CDN}/jquery@3.7.1/dist/jquery.min.js?${nonce()}`)
      return { ...r, body: `${outcome(r, !!window.jQuery)}\n${r.body}` }
    },
    check: (r) => r.body.startsWith('redirected'),
  },
  {
    name: '<link stylesheet>: control',
    expected: 'load event',
    run: () => loadElement('link', `${CDN}/normalize.css@8.0.1/normalize.css?${nonce()}`),
    check: (r) => r.ok,
  },
  {
    name: '<link stylesheet>: blocked',
    expected: 'error event',
    run: () => loadElement('link', `${CDN}/modern-normalize@2.0.0/modern-normalize.css?${nonce()}`),
    check: (r) => !r.ok,
  },
]

document.getElementById('run').addEventListener('click', async () => {
  const tbody = document.getElementById('results')
  tbody.innerHTML = ''
  for (const t of tests) {
    const row = tbody.insertRow()
    row.insertCell().textContent = t.name
    row.insertCell().textContent = t.expected
    const cell = row.insertCell()
    cell.textContent = 'running...'
    const r = await t.run()
    const pass = t.check(r)
    row.className = pass ? 'pass' : 'fail'
    const pre = document.createElement('pre')
    pre.textContent = `${pass ? 'PASS' : 'FAIL'} (${r.ok ? 'loaded' : 'failed'})\n${r.body.slice(0, 400)}`
    cell.replaceChildren(pre)
  }
})
