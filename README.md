# AutoMateIQ Messenger Bot — VS Code version (Node.js)

This is the code version of the AutoMateIQ Facebook Page Messenger bot, built to replace
the n8n workflow. It follows the same rules the user confirmed on 2026-11-01:
- Reply ONLY in Bengali script, never English, even if the customer writes in English.
- Price questions get the full price table, never a handover/contact redirect.
- NEVER give any phone number or email. A contact request is a handover, not a contact reply.
- Picture/image messages are handed over to a human, never described by vision.
- Paused (human takeover) messages are appended to the lead's messages array, so they
  appear on the website thread, with name/profilePic preserved.
- Profile picture is stored in the lead (profilePic column), which was missing in n8n Upsert.

## Connection to the website
The website and this bot talk through the SAME Firebase Firestore collection:
- Collection: `messenger_leads`, document: `<pageId>_<psid>` (pageId 825495483971307)
- Fields: ownerId, pageId, sourcePage, psid, name, status, lastMessage, updated_at, messages, paused, profilePic
- Website Admin Panel reads that collection, so Take Over / Resume AI work unchanged:
  website writes paused=true → bot checks it before replying; website writes paused=false → bot resumes.
- Website reply endpoint: POST /messenger-reply with {businessId, pageId, recipientPsid, message},
  only pageId 825495483971307 accepted, returns {ok: true}. This matches the old n8n
  messenger-reply contract, so the website only needs its webhook URL changed, not its code.
- v6 CHAT REFRESH FIX (2026-11-01): /messenger-reply now ALSO persists the owner message
  to Firestore after a successful Graph send — it appends {role: 'owner', text, created_at}
  to the same messenger_leads doc (<pageId>_<psid>), updates lastMessage/updated_at, and
  returns {ok: true, saved: true} (or saved: false if only the history write failed — the
  Messenger send itself is never failed by a history-write failure). The server is the
  SINGLE writer of owner messages: the website/app must NOT also write the owner message
  to Firestore, or it will appear twice. This endpoint deliberately does NOT change
  paused/status — pause/resume still belong to updateLeadStatus (Take Over / Resume AI).
  Before this fix, replies sent from the website/app vanished on refresh, because refresh
  reloads the thread from Firestore and the owner message was never written there.

## Run locally (test mode, no live message)
```
node test/mock-test.js   # 9 mock tests, fake PSIDs only
PORT=3000 node src/server.js
```
The server currently uses an in-memory store for local tests. Production Firestore wiring
(firebase-admin with a service-account JSON from an environment variable) is the next step
before switching the Page webhook from n8n to this code. Do NOT put any secret in code.

## Environment variables (never in code, never in chat)
- META_VERIFY_TOKEN — Facebook webhook verify token
- PAGE_ACCESS_TOKEN — AutoMateIQ Page Access Token
- VYCEAI_API_KEY — VyceAI API key, for the real AI call (base https://vyceai.com/v1, model deepseek-v4.1, max_tokens 800)
- FIREBASE_SERVICE_ACCOUNT_JSON — Firebase Admin service-account JSON (production only)

## Switch plan (do NOT do this until tests pass)
1. Build + test this code on a test Page / test webhook first.
2. Deploy it to a public HTTPS URL (Vercel / VPS) that can stay up 24/7.
3. Change the Page webhook subscription to the new URL, then turn OFF the n8n bot.
4. Monitor 2 minutes, then live-test: real message → Seen → Typing → Bengali reply, handover, Resume AI.
Until step 3, the live n8n bot (version 10086dad) keeps serving the Page, so customers are not left without replies.
