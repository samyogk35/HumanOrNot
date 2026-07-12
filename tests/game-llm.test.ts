import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateBotResponse } from '../src/game/llm-glue'; 
import { callLLM } from '../src/game/llm-client';

// Mock the raw LLM client so we never make real network calls in tests
vi.mock('../src/game/llm-client', () => {
  return {
    callLLM: vi.fn().mockResolvedValue('I am definitely a real human.'),
  };
});

describe('Game Layer 9a: LLM Glue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should format the prompt correctly with persona and chat history', async () => {
    const chatHistory = [
      { sender: 'Alice', text: 'Hello everyone!' },
      { sender: 'Bob', text: 'Are there any bots here?' }
    ];
    const persona = 'Sassy teenager';

    const response = await generateBotResponse(chatHistory, persona);

    expect(callLLM).toHaveBeenCalledTimes(1);
    
    // The first argument to callLLM should be the prompt string
    const promptPassedToLLM = vi.mocked(callLLM).mock.calls[0][0];

    // Assert the prompt contains the required context
    expect(promptPassedToLLM).toContain(persona);
    expect(promptPassedToLLM).toContain('Alice: Hello everyone!');
    expect(promptPassedToLLM).toContain('Bob: Are there any bots here?');

    // Assert it returns what the mocked LLM replied
    expect(response).toBe('I am definitely a real human.');
  });

  it('should handle empty chat history gracefully', async () => {
    const response = await generateBotResponse([], 'Grumpy old man');
    
    expect(callLLM).toHaveBeenCalledTimes(1);
    const promptPassedToLLM = vi.mocked(callLLM).mock.calls[0][0];
    
    expect(promptPassedToLLM).toContain('Grumpy old man');
    expect(response).toBe('I am definitely a real human.');
  });
});
