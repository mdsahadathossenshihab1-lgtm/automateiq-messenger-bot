// Real VyceAI client. Used only when VYCEAI_API_KEY is set in env.
// Otherwise the server falls back to the mock AI used in local tests.
// Never put the key in code, never log it.
export async function vyceAiReply({ text, history, systemPrompt }) {
  const key = process.env.VYCEAI_API_KEY || '';
  if (!key) throw new Error('VYCEAI_API_KEY not set');
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history ? [{ role: 'user', content: `আগের কথোপকথন:\n${history}\n\nবর্তমান মেসেজ: ${text}` }] : []),
    { role: 'user', content: text },
  ];
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://vyceai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'deepseek-v4.1', messages, max_tokens: 800, temperature: 0.3 }),
      });
      if (!res.ok) throw new Error(`VyceAI HTTP ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return content;
      throw new Error('VyceAI empty reply');
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw lastError;
}
