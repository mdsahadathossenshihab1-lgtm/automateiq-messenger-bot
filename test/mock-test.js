import { MemoryStore } from '../src/store.js';
import { handleMessaging } from '../src/bot.js';
import { TRANSFER_BENGALI } from '../src/prompt.js';

const store = new MemoryStore();
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const hasLatin = s => /[A-Za-z]/.test(s || '');
const hasContact = s => /\d{10,}|@/.test(s || '');

const FAKE = '999999999999901';
// (a) price Bengali, no contact, no English
let r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'Messenger Chatbot er dam koto?', mid: 'm1' } }, { store });
check('(a) price Bengali no contact', r.action === 'ai-reply' && r.reply.includes('৳৫০') && !hasLatin(r.reply) && !hasContact(r.reply), r.reply);
// (b) memory: bare "দাম কত?" after prior conversation
r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'দাম কত?', mid: 'm2' } }, { store });
check('(b) memory price', r.action === 'ai-reply' && r.reply.includes('৳'), r.reply);
// (h) details Bengali, no contact
r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'মেসেঞ্জার চ্যাটবট সম্পর্কে বিস্তারিত জানতে চাই', mid: 'm3' } }, { store });
check('(h) details Bengali no contact', r.action === 'ai-reply' && r.reply.includes('২৪ ঘণ্টা') && !hasContact(r.reply), r.reply);
// (k-new) contact request -> transfer, no contact
r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'আপনাদের কন্টাক্ট ইনফো দেন', mid: 'm4' } }, { store });
check('(k) contact -> transfer no contact', r.action === 'handover' && r.reply === TRANSFER_BENGALI && !hasContact(r.reply) && r.lead.paused === true, JSON.stringify(r));
// (d) paused append: two messages while paused, both in array, lastMessage = second
r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'আমি মানুষের সাথে কথা বলতে চাই', mid: 'm5' } }, { store });
check('(d1) paused append first', r.action === 'paused-append' && r.lead.messages.at(-1).text === 'আমি মানুষের সাথে কথা বলতে চাই', JSON.stringify(r.lead?.messages?.slice(-2)));
r = await handleMessaging({ sender: { id: FAKE }, message: { text: 'আরেকটা প্রশ্ন আছে', mid: 'm6' } }, { store });
check('(d2) paused append second in order', r.action === 'paused-append' && r.lead.messages.at(-1).text === 'আরেকটা প্রশ্ন আছে' && r.lead.lastMessage === 'আরেকটা প্রশ্ন আছে');
// (e) delivery filtered
r = await handleMessaging({ sender: { id: FAKE }, delivery: { mids: ['x'] } }, { store });
check('(e) delivery filtered', r.action === 'filtered');
// (p) picture -> handover, no description
const FAKE2 = '999999999999902';
r = await handleMessaging({ sender: { id: FAKE2 }, message: { attachments: [{ type: 'image', payload: { url: 'https://picsum.photos/id/237/320/240' } }], mid: 'm7' } }, { store });
check('(p) picture -> handover no description', r.action === 'handover' && r.reply === TRANSFER_BENGALI && !/কুকুর|dog/i.test(r.reply), r.reply);
// (g) profile pic preserved via store upsert (mock profile path in bot uses fetchProfile; here store-level check)
await store.upsert({ ownerId: 'x', pageId: '825495483971307', sourcePage: 'automateiq', psid: FAKE2, name: 'Mock User', status: 'bot_replied', lastMessage: 'hi', updated_at: new Date().toISOString(), messages: [], paused: false, profilePic: 'https://example.com/pic.jpg' });
const lead = await store.get('825495483971307', FAKE2);
check('(g) profilePic stored and not cleared', lead.profilePic === 'https://example.com/pic.jpg' && lead.name === 'Mock User');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
