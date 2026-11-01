import http from 'node:http';
import { handleMessaging, isUserMessageEvent, mockAiReply } from './bot.js';
import { createStore } from './firestore.js';
import { vyceAiReply } from './ai.js';
import { PAGE_ID } from './prompt.js';

const store = await createStore();
const aiReply = process.env.VYCEAI_API_KEY ? vyceAiReply : mockAiReply;
if (process.env.VYCEAI_API_KEY) console.log('[ai] using real VyceAI');
else console.log('[ai] no VyceAI key set, using mock AI (local test mode)');
const seenMessageIds = new Set();
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const GRAPH_VERSION = 'v21.0';

async function graphPost(path, body) {
  if (!PAGE_TOKEN) { console.log('[graph-skipped-no-token]', path); return null; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: PAGE_TOKEN }),
  });
  return res.json();
}
async function markSeen(psid) { return graphPost('/me/messages', { recipient: { id: psid }, sender_action: 'mark_seen' }); }
async function typingOn(psid) { return graphPost('/me/messages', { recipient: { id: psid }, sender_action: 'typing_on' }); }
async function sendMessage(psid, text) {
  await new Promise(r => setTimeout(r, 5000));
  return graphPost('/me/messages', { recipient: { id: psid }, message: { text }, messaging_type: 'RESPONSE' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Meta webhook verification: GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
    if (req.method === 'GET' && url.pathname === '/webhook') {
      if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(url.searchParams.get('hub.challenge') || '');
      } else { res.writeHead(403); res.end('Forbidden'); }
      return;
    }
    // Website reply endpoint, same contract as the n8n messenger-reply workflow.
    // Body: {businessId, pageId, recipientPsid, message}. Only the AutoMateIQ page is accepted.
    // Body must NOT contain token/password/secret fields.
    if (req.method === 'POST' && url.pathname === '/messenger-reply') {
      const body = await readBody(req);
      if (!body.businessId || !body.pageId || !body.recipientPsid || !body.message) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'missing-field' })); return; }
      if (body.pageId !== PAGE_ID) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'page-not-allowed' })); return; }
      if (/(token|password|secret)/i.test(JSON.stringify(Object.keys(body)))) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'forbidden-field' })); return; }
      await sendMessage(body.recipientPsid, body.message);
      // v6 CHAT REFRESH FIX: the Graph send alone left the owner
      // message out of Firestore, so the website/app thread lost it
      // on refresh (they reload from Firestore). The server is now
      // the SINGLE writer of owner messages: append here, and the
      // website/app only READ the thread back. upsert() merges, so
      // paused/status/name/profilePic/ownerId are preserved — this
      // endpoint deliberately does NOT change paused/status (the
      // app/website updateLeadStatus owns pause/resume).
      // A history-write failure must never fail the Messenger send.
      let saved = false;
      try {
        const existing = await store.get(body.pageId, body.recipientPsid);
        const prior = existing?.messages || [];
        await store.upsert({
          pageId: body.pageId,
          psid: body.recipientPsid,
          lastMessage: body.message,
          updated_at: new Date().toISOString(),
          messages: [...prior, { role: 'owner', text: body.message, created_at: new Date().toISOString() }],
        });
        saved = true;
      } catch (e) { console.error('[messenger-reply history-write failed]', e); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, saved })); return;
    }
    // Messenger webhook: POST /webhook
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const body = await readBody(req);
      if (body.object !== 'page') { res.writeHead(200); res.end('ok'); return; }
      for (const entry of body.entry || []) {
        for (const messaging of entry.messaging || []) {
          const mid = messaging.message?.mid;
          if (mid && seenMessageIds.has(mid)) continue;
          if (mid) seenMessageIds.add(mid);
          if (!isUserMessageEvent(messaging)) continue;
          const psid = messaging.sender.id;
          await markSeen(psid);
          const result = await handleMessaging(messaging, { store, aiReply });
          if (result.action === 'ai-reply') { await typingOn(psid); await sendMessage(psid, result.reply); }
          else if (result.action === 'handover') { await typingOn(psid); await sendMessage(psid, result.reply); }
          // paused-append: no AI, no Send, on purpose.
        }
      }
      res.writeHead(200); res.end('ok'); return;
    }
    res.writeHead(404); res.end('not-found');
  } catch (e) { console.error(e); res.writeHead(500); res.end('error'); }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`AutoMateIQ bot listening on :${port} (set META_VERIFY_TOKEN and PAGE_ACCESS_TOKEN in env, never in code)`));
