import { describe, it, expect } from 'vitest';
import { cleanContextMessages } from '../src/contextUtils';

describe('cleanContextMessages', () => {
  it('should remove summary line from assistant messages', () => {
    const messages = [
      { 
        role: 'assistant', 
        content: [{ type: 'text', text: '⚡ read(1)\nHello' }] 
      }
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe('Hello');
  });

  it('should not remove lines starting with ⚡ if they are not at the very beginning', () => {
    const messages = [
      { 
        role: 'assistant', 
        content: [{ type: 'text', text: 'Hello\n⚡ read(1)\nWorld' }] 
      }
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe('Hello\n⚡ read(1)\nWorld');
  });

  it('should handle messages without content array', () => {
    const messages = [
      { role: 'user', content: 'Hello' }
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content).toBe('Hello');
  });

  it('should leave assistant messages intact if no summary exists', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: 'Just some text' }] }
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe('Just some text');
  });
});
