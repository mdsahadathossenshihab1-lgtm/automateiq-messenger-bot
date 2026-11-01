// Lead store matching the website's Firestore shape exactly:
// collection messenger_leads, doc <pageId>_<psid>
// fields: ownerId, pageId, sourcePage, psid, name, status, lastMessage, updated_at, messages, paused, profilePic
// Production wiring: replace MemoryStore with firebase-admin (Firestore) using a service-account
// JSON from an environment variable only. No secret value is ever stored in this repo.
// For local tests, MemoryStore is used and nothing is written to real Firestore.

export class MemoryStore {
  constructor() { this.docs = new Map(); }
  key(pageId, psid) { return `${pageId}_${psid}`; }
  async get(pageId, psid) { return this.docs.get(this.key(pageId, psid)) || null; }
  async upsert(lead) {
    const existing = await this.get(lead.pageId, lead.psid);
    const merged = { ...(existing || {}), ...lead };
    // Never overwrite a real name with Unknown, never clear a stored picture with empty.
    if (existing?.name && existing.name !== 'Unknown') merged.name = existing.name;
    if (existing?.profilePic && !lead.profilePic) merged.profilePic = existing.profilePic;
    this.docs.set(this.key(lead.pageId, lead.psid), merged);
    return merged;
  }
  async updatePaused(pageId, psid, patch) {
    const existing = await this.get(pageId, psid);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    if (patch.name === 'Unknown' && existing.name) merged.name = existing.name;
    if (!patch.profilePic && existing.profilePic) merged.profilePic = existing.profilePic;
    this.docs.set(this.key(pageId, psid), merged);
    return merged;
  }
}
