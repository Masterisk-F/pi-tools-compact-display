import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ToolExecutionComponent,
	UserMessageComponent,
	AssistantMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Text, Container, Spacer } from "@earendil-works/pi-tui";
import { loadConfig, resolveToolConfig, getEffectiveToolName } from "./config";
import { formatOutput } from "./renderUtils";
import { cleanContextMessages } from "./contextUtils";
import { ZERO, wrapWithBox } from "./uiUtils";
import { SummaryTracker } from "./state";
import { registerCustomTools } from "./tools";
import path from "path";
import os from "os";

export default function (pi: ExtensionAPI) {
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools-compact-display", "config.json");
	const config = loadConfig(configPath);
	const tracker = new SummaryTracker();

	// @ts-ignore
	const originalRebuild = UserMessageComponent.prototype.rebuild;
	// @ts-ignore
	UserMessageComponent.prototype.rebuild = function () {
		originalRebuild.call(this);
		if (config.user?.noPadding) {
			const box = (this as any).children?.[0];
			if (box) {
				box.paddingY = 0;
				if (typeof box.invalidate === 'function') {
					box.invalidate();
				}
			}
		}
	};

	let lastAddedSpacer: any = null;
	let lastSignificantComponentType: string | null = null;

	const isSpacer = (c: any) => c && c.constructor && c.constructor.name === "Spacer";
	const isUserMessage = (c: any) => c && c.constructor && c.constructor.name === "UserMessageComponent";
	const isAssistantMessage = (c: any) => c && c.constructor && c.constructor.name === "AssistantMessageComponent";

	// Retrieve Container prototype from AssistantMessageComponent to be loader-agnostic
	const containerProto = Object.getPrototypeOf(AssistantMessageComponent.prototype) || Container.prototype;

	// @ts-ignore
	const originalAddChild = containerProto.addChild;
	// @ts-ignore
	const originalAddChildTui = Container.prototype.addChild;

	const hasProto = (obj: any, proto: any) => {
		let p = Object.getPrototypeOf(obj);
		while (p) {
			if (p === proto) return true;
			p = Object.getPrototypeOf(p);
		}
		return false;
	};

	const customAddChild = function (this: any, comp: any) {
		if (config.user?.noPadding) {
			if (isSpacer(comp)) {
				lastAddedSpacer = comp;
				if (lastSignificantComponentType === "user") {
					comp.lines = 0;
				}
			} else if (isUserMessage(comp)) {
				if (lastAddedSpacer) {
					lastAddedSpacer.lines = 0;
				}
				lastSignificantComponentType = "user";
				lastAddedSpacer = null;
			} else if (isAssistantMessage(comp)) {
				lastSignificantComponentType = "assistant";
				lastAddedSpacer = null;
			}
		}

		if (originalAddChildTui !== originalAddChild) {
			if (hasProto(this, Container.prototype)) {
				originalAddChildTui.call(this, comp);
			} else {
				originalAddChild.call(this, comp);
			}
		} else {
			originalAddChild.call(this, comp);
		}

		if (config.user?.noPadding) {
			if (isAssistantMessage(comp)) {
				lastSignificantComponentType = "assistant";
			}
		}
	};

	// @ts-ignore
	containerProto.addChild = customAddChild;
	if (Container.prototype !== containerProto) {
		// @ts-ignore
		Container.prototype.addChild = customAddChild;
	}

	// @ts-ignore
	const originalGetCallRenderer = ToolExecutionComponent.prototype.getCallRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getCallRenderer = function () {
		// @ts-ignore
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);
		if (toolConfig.mode === 'count_only') {
			return () => ZERO;
		} else if (toolConfig.mode === 'lines') {
			return (args: any, theme: any, context: any) => {
				// @ts-ignore
				const effectiveName = getEffectiveToolName((this as any).toolName, args);
				// If it's the mcp gateway tool, render compactly as "mcp call <tool>" with args preview
				// @ts-ignore
				if ((this as any).toolName === 'mcp') {
					const action = args.action || (args.tool ? `call ${args.tool}` : '');
					// Parse args.args (JSON string) for display
					let actualArgs: Record<string, unknown> = {};
					if (args.args && typeof args.args === 'string') {
						try {
							actualArgs = JSON.parse(args.args);
						} catch {
							actualArgs = {};
						}
					}
					const keys = Object.keys(actualArgs);
					let argsStr = "";
					if (keys.length > 0) {
						const parts = keys.map((k: string) => {
							const v = actualArgs[k];
							const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
							const truncatedV = vStr.length > 30 ? vStr.slice(0, 27) + "..." : vStr;
							return `${k}: ${truncatedV}`;
						});
						argsStr = ` { ${parts.join(", ")} }`;
					}
					const bold = typeof theme.bold === 'function' ? theme.bold : (s: string) => s;
					const title = theme.fg("toolTitle", bold(`mcp ${action}`));
					return wrapWithBox(new Text(`${title}${theme.fg("dim", argsStr)}`, 0, 0), theme, context, toolConfig);
				}
				// If the original renderer exists, use it (e.g. bash, edit have their own concise renderers)
				const origRenderer = originalGetCallRenderer.call(this);
				if (origRenderer) {
					return origRenderer(args, theme, context);
				}
				// Fallback to a single-line bold title
				const bold = typeof theme.bold === 'function' ? theme.bold : (s: string) => s;
				return wrapWithBox(new Text(theme.fg("toolTitle", bold(effectiveName)), 0, 0), theme, context, toolConfig);
			};
		}
		return originalGetCallRenderer.call(this);
	};

	// @ts-ignore
	const originalGetResultRenderer = ToolExecutionComponent.prototype.getResultRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getResultRenderer = function () {
		const origRenderer = originalGetResultRenderer.call(this);
		// @ts-ignore
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
				return wrapWithBox(new Text(coloredText, 0, 0), theme, context, toolConfig);
			};
		}
		return origRenderer;
	};

	// @ts-ignore
	const originalGetRenderShell = ToolExecutionComponent.prototype.getRenderShell;
	// @ts-ignore
	ToolExecutionComponent.prototype.getRenderShell = function () {
		// @ts-ignore
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);
		if (toolConfig.mode === 'count_only') {
			return "self";
		}
		// Use "self" for lines mode to bypass contentBox padding (wrapWithBox handles padding via config)
		if (toolConfig.mode === 'lines') {
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
			tracker.countCall(event.toolCallId, displayName);
		}
	});

	// ── Detect errors in count_only tools ──
	pi.on("tool_result", async (event) => {
		const args = (event as any).input;
		const toolConfig = resolveToolConfig(event.toolName, args, config);
		if (toolConfig.mode === 'count_only' && event.isError) {
			tracker.setError();
		}
	});

	// ── Prepend summary to assistant's text response ──
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		if (!tracker.hasGrouped()) return;

		const content = event.message.content;
		if (!Array.isArray(content)) return;

		// Only modify text-only messages (no tool_use = final response)
		if (content.some((b: any) => b.type === "tool_use")) return;

		const summary = tracker.getSummaryLine();
		const hasErrors = tracker.hasErrors();
		tracker.reset();

		const theme = ctx?.ui?.theme;
		const styledSummary = theme
			? theme.bg(hasErrors ? "toolErrorBg" : "toolSuccessBg", ` ${summary} `)
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

	// ── Register built-in tools ──
	registerCustomTools(pi);
}
