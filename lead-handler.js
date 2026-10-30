// Replaces the Elementor/WordPress form submission (admin-ajax.php), which does not exist on a static host.
// On submit: optionally POSTs the answers as JSON to LEAD_CONFIG.webhookUrl, then opens WhatsApp with them.
window.LEAD_CONFIG = Object.assign({
  whatsapp: '5547997601329',   // number that receives the lead
  webhookUrl: '',              // e.g. Make/Zapier/n8n/Google Apps Script URL; empty = WhatsApp only
  openWhatsApp: true
}, window.LEAD_CONFIG || {});

document.addEventListener('submit', function (ev) {
  var form = ev.target;
  if (!form.classList || !form.classList.contains('elementor-form')) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (!form.reportValidity()) return;

  var answers = [];
  form.querySelectorAll('[name^="form_fields["]').forEach(function (el) {
    var label = form.querySelector('label[for="' + el.id + '"]');
    answers.push({
      field: el.name.slice(12, -1),
      label: label ? label.textContent.trim() : el.name,
      value: el.value.trim()
    });
  });

  var cfg = window.LEAD_CONFIG;
  if (cfg.webhookUrl) {
    var payload = { page: location.href, sent_at: new Date().toISOString(), answers: answers };
    fetch(cfg.webhookUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) })
      .catch(function () {});
  }
  if (window.fbq) fbq('track', 'Lead');
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
