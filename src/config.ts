import fs from 'fs';

export type DisplayMode = 'count_only' | 'lines' | 'default';

export interface ToolConfig {
  mode: DisplayMode;
  outputLines?: number;
  noPadding?: boolean;
}

export type Config = Record<string, ToolConfig>;

export function loadConfig(configPath: string): Config {
  let userConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      userConfig = JSON.parse(content);
    } catch (e) {
      // Ignore parse errors and use empty
    }
  }

  // Proxy to return 'default' for any unconfigured tool
  return new Proxy(userConfig as Config, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop);
      }
      if (prop === 'then' || prop === 'toJSON') {
        return undefined;
      }
      if (prop in target) {
        return target[prop];
      }
      if ('default' in target) {
        return target['default'];
      }
      return { mode: 'default' };
    }
  });
}

export function getEffectiveToolName(toolName: string, args: any): string {
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

export function resolveToolConfig(toolName: string, args: any, config: Config): ToolConfig {
  const effectiveName = getEffectiveToolName(toolName, args);
  if (effectiveName !== toolName && (effectiveName in config)) {
    return config[effectiveName];
  }
  return config[toolName];
}
