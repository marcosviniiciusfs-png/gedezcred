# Clone — Gedez Cred (gedez.simulead.com.br)

Cópia estática da landing page original (WordPress + Elementor), com todos os CSS, JS, imagens e fontes baixados em `wp-content/` e `wp-includes/`.

## Rodar localmente
    python -I ../tools/serve.py 8790 .
Abra http://localhost:8790

## Publicar
Suba o conteúdo desta pasta para qualquer hospedagem estática (Netlify, Vercel, Hostinger, cPanel...).

## Formulário (quiz de 7 etapas)
O original envia para o WordPress (`admin-ajax.php`), que não existe numa hospedagem estática.
Aqui, `lead-handler.js` faz o envio:
- abre o WhatsApp `5547997601329` com todas as respostas;
- opcionalmente faz POST (JSON) para `webhookUrl` (Make, Zapier, n8n, Google Apps Script...).

Para configurar, edite o topo de `lead-handler.js`.

## Rastreamento
Meta Pixel (751852001026491) e GTM (GTM-NW52SR62) foram mantidos, mas só disparam em domínio real — nunca em localhost.
