import { ChatTurn } from './llm-glue';

// Phase 10 stand-in for the real LLM. Same signature as generateBotResponse, so
// the orchestrator is wired identically now and in Phase 13 when the mock is
// swapped for the Ollama-backed responder — no orchestrator changes.
//
// Deterministic on purpose: the reply is chosen by how many messages the bot has
// seen, so a given conversation always produces the same bot line (repeatable
// tests + demos). Lines are short, lowercase, and evasive to read human-ish.
const CANNED_LINES = [
  'lol yeah',
  'idk tbh, hard to say',
  'who do we even think it is',
  'brb grabbing water',
  "that's fair",
  'haha same',
  'no way it was that obvious',
  'hmm not sure i buy that',
];

export async function mockBotResponder(
  history: ChatTurn[],
  _persona: string
): Promise<string> {
  return CANNED_LINES[history.length % CANNED_LINES.length];
}
