import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	ToolExecutionComponent,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config";
import { formatOutput } from "./renderUtils";
import { cleanContextMessages } from "./contextUtils";
import path from "path";
import os from "os";

// ── Zero-height component ──
class ZeroHeight {
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
const ZERO = new ZeroHeight();

function wrapWithBox(component: any, theme: any, context: any) {
	if (component === ZERO) return ZERO;
	const bgName = context?.isPartial 
		? "toolPendingBg" 
		: context?.isError 
			? "toolErrorBg" 
			: "toolSuccessBg";
	const box = new Box(1, 0, (text: string) => theme.bg(bgName, text));
	box.addChild(component);
	return box;
}

// ── Counting ──
const seenIds = new Set<string>();
const toolCounts = new Map<string, number>();
let hasGroupedTools = false;
let hasToolErrors = false;

function resetBuffer() {
	seenIds.clear();
	toolCounts.clear();
	hasGroupedTools = false;
	hasToolErrors = false;
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

function getEffectiveToolName(toolName: string, args: any): string {
	if (!args || typeof args !== 'object') return toolName;

	// General fallback for gateway tools that use "tool" or "action" arguments
	if (toolName !== 'mcp') {
		if (args.tool && typeof args.tool === 'string') return `${toolName}:${args.tool}`;
		if (args.action && typeof args.action === 'string') return `${toolName}:${args.action}`;
		return toolName;
	}

	// Specific parsing for mcp
	if (args.action) return `mcp:${args.action}`;
	if (args.tool) return `mcp:${args.tool}`;
	if (args.connect) return `mcp:connect`;
	if (args.describe) return `mcp:describe`;
	if (args.search) return `mcp:search`;
	if (args.server) return `mcp:list`;
	return `mcp:status`;
}

function resolveToolConfig(toolName: string, args: any, config: any) {
	const effectiveName = getEffectiveToolName(toolName, args);
	if (effectiveName !== toolName && (effectiveName in config)) {
		return config[effectiveName];
	}
	return config[toolName];
}

export default function (pi: ExtensionAPI) {
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools-compact-display", "config.json");
	const config = loadConfig(configPath);

	// @ts-ignore
	const originalGetCallRenderer = ToolExecutionComponent.prototype.getCallRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getCallRenderer = function() {
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);
		if (toolConfig.mode === 'count_only') {
			return () => ZERO;
		}
		return originalGetCallRenderer.call(this);
	};

	// @ts-ignore
	const originalGetResultRenderer = ToolExecutionComponent.prototype.getResultRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getResultRenderer = function() {
		const origRenderer = originalGetResultRenderer.call(this);
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);

		if (toolConfig.mode === 'count_only') {
			return () => ZERO;
		} else if (toolConfig.mode === 'lines') {
			return (result: any, options: any, theme: any, context: any) => {
				if (options.isPartial) return ZERO;
				const textItem = result.content?.find((c: any) => c.type === "text");
				const rawText = textItem?.text ?? "";
				const formattedText = formatOutput(rawText, toolConfig, !!options.expanded);
				if (!formattedText) return ZERO;
				const coloredText = formattedText.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");
				return wrapWithBox(new Text(coloredText, 0, 0), theme, context);
			};
		}
		return origRenderer;
	};

	// @ts-ignore
	const originalGetRenderShell = ToolExecutionComponent.prototype.getRenderShell;
	// @ts-ignore
	ToolExecutionComponent.prototype.getRenderShell = function() {
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);
		if (toolConfig.mode === 'count_only') {
			return "self";
		}
		return originalGetRenderShell.call(this);
	};

	// ── Count tool calls for count_only tools ──
	pi.on("tool_call", async (event) => {
		const args = (event as any).input;
		const toolConfig = resolveToolConfig(event.toolName, args, config);
		if (toolConfig.mode === 'count_only') {
			const displayName = getEffectiveToolName(event.toolName, args);
			countCall(event.toolCallId, displayName);
		}
	});

	// ── Detect errors in count_only tools ──
	pi.on("tool_result", async (event) => {
		const args = (event as any).input;
		const toolConfig = resolveToolConfig(event.toolName, args, config);
		if (toolConfig.mode === 'count_only' && event.isError) {
			hasToolErrors = true;
		}
	});

	// ── Prepend summary to assistant's text response ──
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		if (!hasGroupedTools) return;

		const content = event.message.content;
		if (!Array.isArray(content)) return;

		// Only modify text-only messages (no tool_use = final response)
		if (content.some((b: any) => b.type === "tool_use")) return;

		const summary = getSummaryLine();
		const theme = ctx?.ui?.theme;
		const styledSummary = theme
			? theme.bg(hasToolErrors ? "toolErrorBg" : "toolSuccessBg", ` ${summary} `)
			: summary;

		const newContent = content.map((b: any) => {
			if (b.type === "text") {
				return { ...b, text: `${styledSummary}\n${b.text}` };
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
		renderCall(args, theme, context) {
			const cmd = (args.command || "").length > 80 ? (args.command || "").slice(0, 77) + "..." : args.command || "";
			return wrapWithBox(new Text(`$ ${cmd}`, 0, 0), theme, context);
		},
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!expanded) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			const out = text.split("\n").slice(0, 30).map((l: string) => theme.fg("toolOutput", l)).join("\n");
			return wrapWithBox(new Text(out, 0, 0), theme, context);
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
		renderCall(args, theme, context) {
			const n = args.content ? args.content.split("\n").length : 0;
			return wrapWithBox(new Text(`write ${args.path || "..."}` + (n > 0 ? ` (${n} lines)` : ""), 0, 0), theme, context);
		},
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!context?.isError) return ZERO; // 成功時は非表示
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (!expanded) {
				return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
			}
			return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
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
		renderCall(args, theme, context) { return wrapWithBox(new Text(`edit ${args.path || "..."}`, 0, 0), theme, context); },
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (context?.isError) {
				if (!expanded) {
					return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
				}
				return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
			}
			if (!expanded) return ZERO;
			const details = _result.details as { diff?: string } | undefined;
			if (details?.diff) {
				const lines = details.diff.split("\n").slice(0, 30);
				const out = lines.map(l => {
					if (l.startsWith("+") && !l.startsWith("+++")) return theme.fg("success", l);
					if (l.startsWith("-") && !l.startsWith("---")) return theme.fg("error", l);
					return theme.fg("dim", l);
				}).join("\n");
				return wrapWithBox(new Text(out, 0, 0), theme, context);
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
