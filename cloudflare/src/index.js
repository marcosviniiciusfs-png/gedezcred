// Recebe o lead do quiz, grava em D1 (capi_events) e envia o evento para a Meta Conversions API.
// Um cron reenvia o que ficou pendente ou falhou (por exemplo, enquanto META_ACCESS_TOKEN não existia).

const MAX_ATTEMPTS = 5;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return json({ ok: true, meta_token: Boolean(env.META_ACCESS_TOKEN) }, 200, cors);
    if (url.pathname !== '/lead' || request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origin_not_allowed' }, 403, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400, cors);
    }
    if (!body.event_id || typeof body.event_id !== 'string' || body.event_id.length > 100) {
      return json({ error: 'event_id_required' }, 400, cors);
    }

    const row = await buildRow(body, request);
    const res = await env.DB.prepare(
      `INSERT INTO capi_events (event_id, event_name, event_time, event_source_url, action_source,
         em_hash, ph_hash, fn_hash, ln_hash, ct_hash, st_hash, zp_hash, country_hash, external_id_hash,
         fbp, fbc, client_ip, client_user_agent, custom_data, utm)
       VALUES (?, ?, ?, ?, 'website', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO NOTHING`
    ).bind(
      row.event_id, row.event_name, row.event_time, row.event_source_url,
      row.em_hash, row.ph_hash, row.fn_hash, row.ln_hash, row.country_hash, row.external_id_hash,
      row.fbp, row.fbc, row.client_ip, row.client_user_agent, row.custom_data, row.utm
    ).run();

    if (res.meta.changes) ctx.waitUntil(sendToMeta(env, row.event_id));
    return json({ ok: true, event_id: row.event_id, duplicate: !res.meta.changes }, 200, cors);
  },

  async scheduled(_event, env, ctx) {
    const { results } = await env.DB.prepare(
      `SELECT event_id FROM capi_events
       WHERE status IN ('pending', 'failed') AND attempts < ? AND event_time > unixepoch() - 7 * 86400
       ORDER BY created_at LIMIT 50`
    ).bind(MAX_ATTEMPTS).all();
    ctx.waitUntil(Promise.all(results.map((r) => sendToMeta(env, r.event_id))));
  },
};

async function buildRow(body, request) {
  const fullName = String(body.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const [first, ...rest] = fullName.split(' ');
  const phone = normalizePhone(body.phone);
  return {
    event_id: body.event_id,
    event_name: /^[A-Za-z]{1,40}$/.test(body.event_name || '') ? body.event_name : 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: String(body.event_source_url || request.headers.get('Referer') || '').slice(0, 500) || null,
    em_hash: body.email ? await sha256(String(body.email).trim().toLowerCase()) : null,
    ph_hash: phone ? await sha256(phone) : null,
    fn_hash: first ? await sha256(stripAccents(first)) : null,
    ln_hash: rest.length ? await sha256(stripAccents(rest[rest.length - 1])) : null,
    country_hash: await sha256('br'),
    external_id_hash: phone ? await sha256('gedez:' + phone) : null,
    fbp: cleanCookie(body.fbp),
    fbc: cleanCookie(body.fbc),
    client_ip: request.headers.get('CF-Connecting-IP'),
    client_user_agent: (request.headers.get('User-Agent') || '').slice(0, 500) || null,
    custom_data: JSON.stringify(sanitizeAnswers(body.answers)),
    utm: body.utm && typeof body.utm === 'object' ? JSON.stringify(body.utm).slice(0, 1000) : null,
  };
}

async function sendToMeta(env, eventId) {
  if (!env.META_ACCESS_TOKEN || !env.META_PIXEL_ID) return; // fica 'pending' até o token existir

  const e = await env.DB.prepare('SELECT * FROM capi_events WHERE event_id = ?').bind(eventId).first();
  if (!e || e.status === 'sent') return;

  const userData = compact({
    em: e.em_hash && [e.em_hash],
    ph: e.ph_hash && [e.ph_hash],
    fn: e.fn_hash && [e.fn_hash],
    ln: e.ln_hash && [e.ln_hash],
    country: e.country_hash && [e.country_hash],
    external_id: e.external_id_hash && [e.external_id_hash],
    fbp: e.fbp,
    fbc: e.fbc,
    client_ip_address: e.client_ip,
    client_user_agent: e.client_user_agent,
  });
  const payload = {
    data: [compact({
      event_name: e.event_name,
      event_time: e.event_time,
      event_id: e.event_id,
      event_source_url: e.event_source_url,
      action_source: e.action_source,
      user_data: userData,
      custom_data: { content_name: 'Simulação de crédito', lead_answers: JSON.parse(e.custom_data || '[]') },
    })],
    ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {}),
  };

  let status = 'failed';
  let responseText;
  let traceId = null;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    responseText = await r.text();
    try { traceId = JSON.parse(responseText).fbtrace_id || null; } catch {}
    if (r.ok) status = 'sent';
  } catch (err) {
    responseText = JSON.stringify({ error: String(err) });
  }

  await env.DB.prepare(
    `UPDATE capi_events SET status = ?, attempts = attempts + 1, meta_response = ?, fbtrace_id = ?,
       sent_at = CASE WHEN ? = 'sent' THEN unixepoch() ELSE sent_at END
     WHERE event_id = ?`
  ).bind(status, (responseText || '').slice(0, 2000), traceId, status, eventId).run();
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

// Telefone no formato da Meta: só dígitos, com DDI 55.
function normalizePhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

function sanitizeAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  // Nome e WhatsApp já vão em hash no user_data; não guardar em texto puro.
  return answers
    .filter((a) => a && !/lead_name|whatsapp|email|phone/i.test(a.field || ''))
    .slice(0, 20)
    .map((a) => ({ field: String(a.field || '').slice(0, 60), label: String(a.label || '').slice(0, 120), value: String(a.value || '').slice(0, 120) }));
}

function cleanCookie(v) {
  return typeof v === 'string' && /^fb\.\d\.\d+\.[\w.-]+$/.test(v) ? v.slice(0, 300) : null;
}

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
