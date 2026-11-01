// Production Firestore store via firebase-admin, if installed and configured.
// Env: FIREBASE_SERVICE_ACCOUNT_JSON = full service-account JSON string.
//       FIREBASE_PROJECT_ID is optional (read from the JSON if present).
// If firebase-admin is not installed or no service account is set, the caller
// must fall back to MemoryStore (local tests). This file never contains a secret.
import { MemoryStore } from './store.js';

export async function createStore() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!saJson) {
    console.log('[store] no service account set, using MemoryStore (local test mode)');
    return new MemoryStore();
  }
  let admin;
  try {
    const imported = await import('firebase-admin');
    admin = imported.default || imported;
  } catch {
    console.log('[store] firebase-admin not installed, using MemoryStore. Run: npm install firebase-admin');
    return new MemoryStore();
  }
  const sa = JSON.parse(saJson);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
  // Website reads Firestore database ai-studio-automateiq-a1b8237c-c72f-49f9-8d26-7de394824bb1.
  // There is NO (default) database in this project, so admin.firestore() with no
  // database ID fails with 5 NOT_FOUND before any AI reply or website write.
  // Use the named database explicitly via getFirestore(app, databaseId).
  const app = admin.apps[0];
  let db;
  try {
    const firestoreMod = await import('firebase-admin/firestore');
    const getFirestore = firestoreMod.getFirestore || firestoreMod.default?.getFirestore;
    db = getFirestore(app, 'ai-studio-automateiq-a1b8237c-c72f-49f9-8d26-7de394824bb1');
  } catch {
    db = admin.firestore();
  }
  const COLLECTION = 'messenger_leads';
  return {
    key: (pageId, psid) => `${pageId}_${psid}`,
    async get(pageId, psid) {
      const doc = await db.collection(COLLECTION).doc(`${pageId}_${psid}`).get();
      return doc.exists ? doc.data() : null;
    },
    async upsert(lead) {
      const ref = db.collection(COLLECTION).doc(`${lead.pageId}_${lead.psid}`);
      const existing = (await ref.get()).data() || {};
      const merged = { ...existing, ...lead };
      if (existing.name && existing.name !== 'Unknown') merged.name = existing.name;
      if (existing.profilePic && !lead.profilePic) merged.profilePic = existing.profilePic;
      await ref.set(merged, { merge: true });
      return merged;
    },
    async updatePaused(pageId, psid, patch) {
      const ref = db.collection(COLLECTION).doc(`${pageId}_${psid}`);
      const existing = (await ref.get()).data() || {};
      const merged = { ...existing, ...patch };
      if (patch.name === 'Unknown' && existing.name) merged.name = existing.name;
      if (!patch.profilePic && existing.profilePic) merged.profilePic = existing.profilePic;
      await ref.set(merged, { merge: true });
      return merged;
    },
  };
}
