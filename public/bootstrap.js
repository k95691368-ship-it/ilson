// External, deferred bootstrap: CSP needs neither inline scripts nor eval.
window.dataLayer = window.dataLayer || []
window.gtag = function () { window.dataLayer.push(arguments) }
window.gtag('js', new Date())
window.gtag('config', 'G-VLP0X6V7TM', {
  send_page_view: false,
  // Safe defaults also cover automatic events before React reports a page view.
  page_location: window.location.origin + '/',
  page_referrer: '',
})

function loadTag(src) {
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.appendChild(script)
}
loadTag('https://www.googletagmanager.com/gtag/js?id=G-VLP0X6V7TM')
window.clarity = window.clarity || function () {
  ;(window.clarity.q = window.clarity.q || []).push(arguments)
}
loadTag('https://www.clarity.ms/tag/y28b6n8ub2')

if (location.pathname === '/' && document.documentElement.dataset.sharedDemoPrefetch === 'true') {
  window.__boot = {}
  for (const path of ['/override']) {
    window.__boot[path] = fetch('/api' + path, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null)
  }
}
