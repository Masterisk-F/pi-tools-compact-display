import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config";
import { formatOutput } from "./renderUtils";
import { cleanContextMessages } from "./contextUtils";
import fs from "fs";
import path from "path";
import os from "os";

// ── Zero-height component ──
class ZeroHeight {
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
const ZERO = new ZeroHeight();

// ── Counting ──
const seenIds = new Set<string>();
const toolCounts = new Map<string, number>();
let hasGroupedTools = false;

function resetBuffer() {
	seenIds.clear();
	toolCounts.clear();
	hasGroupedTools = false;
}

function countCall(id: string, toolName: string) {
	if (seenIds.has(id)) return;
	seenIds.add(id);
	toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
	hasGroupedTools = true;
}

function getSummaryLine(): string {
	const parts = [...toolCounts.entries()].map(([n, c]) => `${n}(${c})`);
	return `⚡ ${parts.join(" ")}`;
}

// ── Tool cache ──
const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();
function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd), bash: createBashTool(cwd),
		edit: createEditTool(cwd), write: createWriteTool(cwd),
		find: createFindTool(cwd), grep: createGrepTool(cwd), ls: createLsTool(cwd),
	};
}
function getTools(cwd: string) {
	let t = toolCache.get(cwd);
	if (!t) { t = createBuiltInTools(cwd); toolCache.set(cwd, t); }
	return t;
}

export default function (pi: ExtensionAPI) {
	const globalConfigPath = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools-compact-display", "config.json");
	let configPath = globalConfigPath;

	try {
		// Use import.meta.url to find the local config.json relative to dist/index.js
		const currentDir = path.dirname(new URL(import.meta.url).pathname);
		const localConfigPath = path.join(currentDir, "..", "config.json");
		if (fs.existsSync(localConfigPath) && !fs.existsSync(globalConfigPath)) {
			configPath = localConfigPath;
		}
	} catch (e) {
		// Ignore errors
	}

	const config = loadConfig(configPath);

	// Monkey patch registerTool to apply config dynamically
	const originalRegisterTool = pi.registerTool.bind(pi);
	pi.registerTool = function(tool: any) {
		const toolConfig = config[tool.name] || { mode: 'default' };

		if (toolConfig.mode === 'count_only') {
			// override renders
			tool.renderCall = () => ZERO;
			tool.renderResult = () => ZERO;
		} else if (toolConfig.mode === 'lines') {
			const origRenderResult = tool.renderResult;
			if (origRenderResult) {
				tool.renderResult = (result: any, options: any, theme: any) => {
					if (options.isPartial) return ZERO;
					const textItem = result.content?.find((c: any) => c.type === "text");
					const rawText = textItem?.text ?? "";
					
					// If expanded is not passed or undefined, formatOutput handles it
					const formattedText = formatOutput(rawText, toolConfig, !!options.expanded);

					// If text is empty after formatting, return ZERO
					if (!formattedText) return ZERO;

					const coloredText = formattedText.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");
					return new Text("\n" + coloredText, 0, 0);
				};
			}
		}

		originalRegisterTool(tool);
	};

	// ── Count tool calls for count_only tools ──
	pi.on("tool_call", async (event) => {
		const toolConfig = config[event.toolName] || { mode: 'default' };
		if (toolConfig.mode === 'count_only') {
			countCall(event.toolCallId, event.toolName);
		}
	});

	// ── Prepend summary to assistant's text response ──
	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		if (!hasGroupedTools) return;

		const content = event.message.content;
		if (!Array.isArray(content)) return;

		// Only modify text-only messages (no tool_use = final response)
		if (content.some((b: any) => b.type === "tool_use")) return;

		const summary = getSummaryLine();
		const newContent = content.map((b: any) => {
			if (b.type === "text") {
				return { ...b, text: `${summary}\n${b.text}` };
			}
			return b;
		});

		return { message: { ...event.message, content: newContent } };
	});

	// ── Strip summary before sending to LLM ──
	pi.on("context", async (event) => {
		const cleaned = cleanContextMessages(event.messages);
		return { messages: cleaned };
	});

	// ── Reset on each new prompt ──
	pi.on("agent_start", () => resetBuffer());

	// ── Register built-in tools (they will be patched by the overwritten registerTool) ──
	const orig = getTools(process.cwd());

	// Bash
	pi.registerTool({
		name: "bash", label: "bash",
		description: "Execute a bash command.",
		parameters: orig.bash.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args) {
			const cmd = (args.command || "").length > 80 ? (args.command || "").slice(0, 77) + "..." : args.command || "";
			return new Text(`$ ${cmd}`, 0, 0);
		},
		renderResult(_result, { expanded, isPartial }, theme) {
			if (isPartial) return ZERO;
			if (!expanded) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			const out = text.split("\n").slice(0, 30).map((l: string) => theme.fg("toolOutput", l)).join("\n");
			return new Text("\n" + out, 0, 0);
		},
	});

	// Read
	pi.registerTool({
		name: "read", label: "read",
		description: "Read a file.",
		parameters: orig.read.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Write
	pi.registerTool({
		name: "write", label: "write",
		description: "Write content to a file.",
		parameters: orig.write.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args) {
			const n = args.content ? args.content.split("\n").length : 0;
			return new Text(`write ${args.path || "..."}` + (n > 0 ? ` (${n} lines)` : ""), 0, 0);
		},
		renderResult(_result, { expanded, isPartial }, theme) {
			if (isPartial) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (!expanded) {
				if (text && (text.startsWith("Error") || text.includes("error"))) return new Text(theme.fg("error", "error"), 0, 0);
				return ZERO;
			}
			if (text && (text.startsWith("Error") || text.includes("error"))) return new Text(`\n${theme.fg("error", text)}`, 0, 0);
			return ZERO;
		},
	});

	// Edit
	pi.registerTool({
		name: "edit", label: "edit",
		description: "Edit a file by replacing exact text.",
		parameters: orig.edit.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args) { return new Text(`edit ${args.path || "..."}`, 0, 0); },
		renderResult(_result, { expanded, isPartial }, theme) {
			if (isPartial) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (!expanded) {
				if (text && (text.startsWith("Error") || text.includes("error"))) return new Text(theme.fg("error", "error"), 0, 0);
				return ZERO;
			}
			if (text && (text.startsWith("Error") || text.includes("error"))) return new Text(`\n${theme.fg("error", text)}`, 0, 0);
			const details = _result.details as { diff?: string } | undefined;
			if (details?.diff) {
				const lines = details.diff.split("\n").slice(0, 30);
				const out = lines.map(l => {
					if (l.startsWith("+") && !l.startsWith("+++")) return theme.fg("success", l);
					if (l.startsWith("-") && !l.startsWith("---")) return theme.fg("error", l);
					return theme.fg("dim", l);
				}).join("\n");
				return new Text("\n" + out, 0, 0);
			}
			return ZERO;
		},
	});

	// Ls
	pi.registerTool({
		name: "ls", label: "ls",
		description: "List directory contents.",
		parameters: orig.ls.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Find
	pi.registerTool({
		name: "find", label: "find",
		description: "Find files by name pattern.",
		parameters: orig.find.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Grep
	pi.registerTool({
		name: "grep", label: "grep",
		description: "Search file contents by regex pattern.",
		parameters: orig.grep.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});
}
