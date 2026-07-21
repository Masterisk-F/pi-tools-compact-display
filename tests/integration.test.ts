import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import extension from '../src/index';

vi.mock('fs');

describe('Event Handlers (Integration)', () => {
	let mockPi: any;
	let handlers: Record<string, Function[]>;

	beforeEach(() => {
		vi.resetAllMocks();
		handlers = {};
		mockPi = {
			on: vi.fn((event: string, handler: Function) => {
				if (!handlers[event]) handlers[event] = [];
				handlers[event].push(handler);
			}),
			registerTool: vi.fn(),
		};
	});

	const setupExtension = (configJson: any) => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
		extension(mockPi);
	};

	it('should accumulate tool calls and prepend summary to final text response', async () => {
		setupExtension({
			read: { mode: 'count_only' },
			grep: { mode: 'count_only' },
		});

		// Trigger tool calls
		const toolCallHandler = handlers['tool_call']?.[0];
		expect(toolCallHandler).toBeDefined();

		await toolCallHandler({ toolCallId: '1', toolName: 'read', input: {} });
		await toolCallHandler({ toolCallId: '2', toolName: 'read', input: {} });
		await toolCallHandler({ toolCallId: '3', toolName: 'grep', input: {} });

		// Trigger message_end for final text-only assistant response
		const messageEndHandler = handlers['message_end']?.[0];
		expect(messageEndHandler).toBeDefined();

		const originalMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'This is the final response.' }
			],
			stopReason: 'stop',
		};

		const mockCtx = {
			ui: {
				theme: {
					bg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				},
			},
		};

		const result = await messageEndHandler({ message: originalMessage }, mockCtx);

		expect(result).toBeDefined();
		expect(result.message.content[0].text).toContain('⚡ read(2) grep(1)');
		expect(result.message.content[0].text).toContain('This is the final response.');
	});

	it('should NOT prepend summary or reset tracker if assistant message is a toolUse stopReason', async () => {
		setupExtension({
			read: { mode: 'count_only' },
		});

		const toolCallHandler = handlers['tool_call']?.[0];
		await toolCallHandler({ toolCallId: '1', toolName: 'read', input: {} });

		const messageEndHandler = handlers['message_end']?.[0];

		const intermediateMessage = {
			role: 'assistant',
			content: [
				{ type: 'toolCall', id: '1', name: 'read', arguments: {} }
			],
			stopReason: 'toolUse',
		};

		const result = await messageEndHandler({ message: intermediateMessage });
		expect(result).toBeUndefined(); // skipped

		// Now send the final message, the count should still be there!
		const finalMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Done.' }
			],
			stopReason: 'stop',
		};

		const finalResult = await messageEndHandler({ message: finalMessage });
		expect(finalResult).toBeDefined();
		expect(finalResult.message.content[0].text).toContain('⚡ read(1)\nDone.');
	});

	it('should NOT prepend summary or reset tracker if content contains toolCall blocks', async () => {
		setupExtension({
			read: { mode: 'count_only' },
		});

		const toolCallHandler = handlers['tool_call']?.[0];
		await toolCallHandler({ toolCallId: '1', toolName: 'read', input: {} });

		const messageEndHandler = handlers['message_end']?.[0];

		const intermediateMessage = {
			role: 'assistant',
			content: [
				{ type: 'toolCall', id: '1', name: 'read', arguments: {} }
			],
			stopReason: 'stop', // let's say stopReason is stop, but content still has toolCall
		};

		const result = await messageEndHandler({ message: intermediateMessage });
		expect(result).toBeUndefined(); // skipped

		// Now send the final message
		const finalMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Done.' }
			],
			stopReason: 'stop',
		};

		const finalResult = await messageEndHandler({ message: finalMessage });
		expect(finalResult).toBeDefined();
		expect(finalResult.message.content[0].text).toContain('⚡ read(1)\nDone.');
	});

	it('should NOT reset tracker if the message does not contain text blocks', async () => {
		setupExtension({
			read: { mode: 'count_only' },
		});

		const toolCallHandler = handlers['tool_call']?.[0];
		await toolCallHandler({ toolCallId: '1', toolName: 'read', input: {} });

		const messageEndHandler = handlers['message_end']?.[0];

		const emptyMessage = {
			role: 'assistant',
			content: [], // empty content array
			stopReason: 'stop',
		};

		const result = await messageEndHandler({ message: emptyMessage });
		expect(result).toBeUndefined(); // skipped

		// Now send the final message
		const finalMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Done.' }
			],
			stopReason: 'stop',
		};

		const finalResult = await messageEndHandler({ message: finalMessage });
		expect(finalResult).toBeDefined();
		expect(finalResult.message.content[0].text).toContain('⚡ read(1)\nDone.');
	});
});
