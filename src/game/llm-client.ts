/**
 * Raw client for the LLM backend (Ollama by default). Kept intentionally thin
 * so the game logic can be unit-tested by mocking this single function.
 */
export async function callLLM(prompt: string): Promise<string> {
  const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { response?: string };
  return (data.response ?? '').trim();
}
