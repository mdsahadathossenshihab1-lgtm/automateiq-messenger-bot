import { OWNER_ID, PAGE_ID, TRANSFER_BENGALI, buildSystemPrompt, isHandoverRequest } from './prompt.js';

// Core bot logic, shared by the webhook server and by local mock tests.
// No live Graph/Firestore/AI call happens here in TEST_MODE; the caller decides
// whether to actually send (production) or just return what WOULD be sent (test).

export function isUserMessageEvent(messaging) {
  if (!messaging) return false;
  if (messaging.delivery || messaging.read) return false;
  if (messaging.sender?.id === PAGE_ID) return false;
  if (messaging.message?.is_echo) return false;
  const msg = messaging.message || {};
  if (!msg.text && !(msg.attachments || []).length && !msg.sticker_id) return false;
  return true;
}

export function hasImage(messaging) {
  const atts = messaging?.message?.attachments || [];
  return atts.some(a => a.type === 'image' || a.payload?.url);
}

export async function mockAiReply({ text, history, hasImage: img }) {
  // Local test stand-in for the VyceAI call. Production uses the same system prompt
  // with model deepseek-v4.1, base https://vyceai.com/v1, max_tokens 800, retry 3.
  if (img) return TRANSFER_BENGALI;
  if (isHandoverRequest(text)) return TRANSFER_BENGALI;
  if (/বিস্তারিত|details/.test(text || '')) {
    return 'মেসেঞ্জার চ্যাটবট হলো আপনার ফেসবুক পেজের জন্য ২৪ ঘণ্টা ৭ দিনের AI অ্যাসিস্ট্যান্ট। কাস্টমার দাম জানতে চাইলে পুরো দামের তালিকা পাবে, প্রোডাক্টের ছবি ও ডিটেইলস গ্যালারি আকারে দেখতে পাবে, মেসেজেই অর্ডার দিতে পারবে। দাম: ট্রায়াল ৭ দিন ৳৫০, স্ট্যান্ডার্ড ৳৭০০/মাস, প্রিমিয়াম ৳১,০০০/মাস, এককালীন ৳৫,০০০, এককালীন প্যাকেজে ৳৫০০ ফ্রি ক্রেডিট। অর্ডার করলে Pending থাকে, অ্যাডমিন ওয়েবসাইটের Inbox থেকে যোগাযোগ করে সেটআপ করেন।';
  }
  if (/দাম|কত|dam|koto|price/i.test(text || '')) {
    return 'মেসেঞ্জার চ্যাটবটের দাম: ট্রায়াল ৭ দিন ৳৫০, স্ট্যান্ডার্ড ৳৭০০/মাস, প্রিমিয়াম ৳১,০০০/মাস, এককালীন ৳৫,০০০। প্রিমিয়ামে ভয়েস মেসেজ সাপোর্ট আছে, এককালীন প্যাকেজে ৳৫০০ ফ্রি ক্রেডিট আছে।';
  }
  if (history && /দাম কত/.test(text || '')) {
    return 'মেসেঞ্জার চ্যাটবটের দাম: ট্রায়াল ৭ দিন ৳৫০, স্ট্যান্ডার্ড ৳৭০০/মাস, প্রিমিয়াম ৳১,০০০/মাস, এককালীন ৳৫,০০০।';
  }
  return 'আসসালামু আলাইকুম, আমি AutoMateIQ-এর অ্যাসিস্ট্যান্ট। আপনার প্রশ্নটা একটু বিস্তারিত বললে আমি সাহায্য করতে পারবো।';
}

export async function handleMessaging(messaging, { store, aiReply = mockAiReply, fetchProfile = null }) {
  if (!isUserMessageEvent(messaging)) return { action: 'filtered', reason: 'non-user-event' };
  const psid = messaging.sender.id;
  const text = messaging.message?.text || '';
  const img = hasImage(messaging);
  const lead = await store.get(PAGE_ID, psid);
  const priorMessages = lead?.messages || [];

  // Paused branch: append the new message, preserve status/name/profilePic, NO AI, NO Send.
  // This is the fix for human-takeover messages not appearing on the website thread.
  if (lead?.paused) {
    const messages = [...priorMessages, { role: 'user', text: text || '[ছবি]' }];
    const updated = await store.updatePaused(PAGE_ID, psid, {
      messages, lastMessage: text || '[ছবি]', updated_at: new Date().toISOString(), paused: true,
    });
    return { action: 'paused-append', lead: updated };
  }

  // Picture -> human handover, never a vision description, never contact info.
  if (img || isHandoverRequest(text)) {
    const messages = [...priorMessages, { role: 'user', text: text || '[ছবি]' }, { role: 'bot', text: TRANSFER_BENGALI }];
    const updated = await store.upsert({
      ownerId: OWNER_ID, pageId: PAGE_ID, sourcePage: 'automateiq', psid,
      name: lead?.name || 'Unknown', status: 'handover', lastMessage: TRANSFER_BENGALI,
      updated_at: new Date().toISOString(), messages, paused: true, profilePic: lead?.profilePic || '',
    });
    return { action: 'handover', reply: TRANSFER_BENGALI, lead: updated };
  }

  // Normal path: fetch profile (if provided), AI reply, append both messages.
  let profile = null;
  if (fetchProfile) { try { profile = await fetchProfile(psid); } catch { profile = null; } }
  const historyText = priorMessages.map(m => `${m.role}: ${m.text}`).join('\n');
  const reply = await aiReply({ text, history: historyText, hasImage: img, systemPrompt: buildSystemPrompt() });
  const messages = [...priorMessages, { role: 'user', text }, { role: 'bot', text: reply }];
  const updated = await store.upsert({
    ownerId: OWNER_ID, pageId: PAGE_ID, sourcePage: 'automateiq', psid,
    name: profile?.name || lead?.name || 'Unknown', status: 'bot_replied', lastMessage: reply,
    updated_at: new Date().toISOString(), messages, paused: false,
    profilePic: profile?.profile_pic || lead?.profilePic || '',
  });
  return { action: 'ai-reply', reply, lead: updated };
}
