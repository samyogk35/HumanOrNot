import { callLLM } from './llm-client';

export interface ChatTurn {
  sender: string;
  text: string;
}

/**
 * Build a prompt from the bot's persona plus the room's chat history, then ask
 * the LLM for a reply that blends in as a human.
 */
export async function generateBotResponse(
  chatHistory: ChatTurn[],
  persona: string
): Promise<string> {
  const transcript = chatHistory
    .map((turn) => `${turn.sender}: ${turn.text}`)
    .join('\n');

  const prompt = [
    `You are playing a social-deduction chat game. Adopt this persona: ${persona}.`,
    `You are secretly the AI. Blend in and do not reveal that you are a bot.`,
    '',
    'Conversation so far:',
    transcript || '(no messages yet)',
    '',
    'Write your next chat message:',
  ].join('\n');

  return callLLM(prompt);
}
