// Replaces the Elementor/WordPress form submission (admin-ajax.php), which does not exist on a static host.
// On submit: sends the lead to the Meta Conversions API Worker (stored in D1, deduplicated with the Pixel
// via a shared event_id), optionally POSTs to LEAD_CONFIG.webhookUrl, then opens WhatsApp with the answers.
window.LEAD_CONFIG = Object.assign({
  whatsapp: '5547997601329',   // number that receives the lead
  capiUrl: 'https://gedez-capi.hurtz-assistente.workers.dev/lead',
  webhookUrl: '',              // e.g. Make/Zapier/n8n/Google Apps Script URL; empty = WhatsApp only
  openWhatsApp: true
}, window.LEAD_CONFIG || {});

// Keep UTMs and fbclid from the landing URL for the whole visit.
(function () {
  try {
    var q = new URLSearchParams(location.search), utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k); });
    if (Object.keys(utm).length) sessionStorage.setItem('lead_utm', JSON.stringify(utm));
    if (q.get('fbclid')) sessionStorage.setItem('lead_fbclid', JSON.stringify({ id: q.get('fbclid'), t: Date.now() }));
  } catch (e) {}
})();

function leadCookie(name) {
  var m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
  return m ? decodeURIComponent(m[1]) : null;
}

function leadSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

document.addEventListener('submit', function (ev) {
  var form = ev.target;
  if (!form.classList || !form.classList.contains('elementor-form')) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (!form.reportValidity()) return;
  // The mask plugin re-submits the form 500ms after the click (requestSubmit); count it only once.
  if (Date.now() - (Number(form.dataset.leadSentAt) || 0) < 5000) return;
  form.dataset.leadSentAt = Date.now();

  var answers = [];
  form.querySelectorAll('[name^="form_fields["]').forEach(function (el) {
    var value = el.value.trim();
    if (!value) return; // pergunta opcional deixada em branco
    var label = form.querySelector('label[for="' + el.id + '"]');
    answers.push({
      field: el.name.slice(12, -1),
      label: label ? label.textContent.trim() : el.name,
      value: value
    });
  });

  var cfg = window.LEAD_CONFIG;
  var eventId = 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  var value = function (field) { var a = answers.filter(function (x) { return x.field === field; })[0]; return a ? a.value : ''; };

  if (cfg.capiUrl) {
    var click = leadSession('lead_fbclid');
    fetch(cfg.capiUrl, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        event_name: 'Lead',
        event_source_url: location.href,
        name: value('lead_name'),
        phone: value('whatsapp'),
        phone_call: value('ligacao'),
        fbp: leadCookie('_fbp'),
        fbc: leadCookie('_fbc') || (click ? 'fb.1.' + click.t + '.' + click.id : null),
        utm: leadSession('lead_utm'),
        answers: answers
      })
    }).catch(function () {});
  }
  if (cfg.webhookUrl) {
    var payload = { page: location.href, sent_at: new Date().toISOString(), answers: answers };
    fetch(cfg.webhookUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) })
      .catch(function () {});
  }
  if (window.fbq) fbq('track', 'Lead', {}, { eventID: eventId });
  if (window.dataLayer) dataLayer.push({ event: 'generate_lead' });

  var msg = form.querySelector('.elementor-message') || document.createElement('div');
  msg.className = 'elementor-message elementor-message-success';
  msg.setAttribute('role', 'alert');
  msg.textContent = 'Simulação enviada! Você receberá o resultado no seu WhatsApp.';
  form.appendChild(msg);

  if (cfg.openWhatsApp && cfg.whatsapp) {
    var text = 'Olá! Quero fazer uma simulação de crédito:\n\n' +
      answers.map(function (a) { return '*' + a.label + '* ' + a.value; }).join('\n');
    window.open('https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent(text), '_blank');
  }
}, true);
