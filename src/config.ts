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
