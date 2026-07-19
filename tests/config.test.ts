import { describe, it, expect, vi } from 'vitest';
import { loadConfig, getEffectiveToolName, resolveToolConfig } from '../src/config';
import fs from 'fs';

vi.mock('fs');

describe('loadConfig', () => {
  it('should return default config if file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig('/invalid/path.json');
    expect(config.read?.mode).toBe('default');
    expect(config.bash?.mode).toBe('default');
    expect(config.unknownTool?.mode).toBe('default');
  });

  it('should merge parsed config with defaults', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      bash: { mode: 'lines', outputLines: 5, noPadding: true },
      read: { mode: 'count_only' }
    }));
    
    const config = loadConfig('/valid/path.json');
    expect(config.bash?.mode).toBe('lines');
    expect(config.bash?.outputLines).toBe(5);
    expect(config.bash?.noPadding).toBe(true);
    expect(config.read?.mode).toBe('count_only');
    
    // 未指定のツールはdefaultになる
    expect(config.write?.mode).toBe('default');
  });

  it('should fall back to "default" key if specified for unconfigured tools', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      default: { mode: 'lines', outputLines: 3, noPadding: false },
      read: { mode: 'count_only' }
    }));
    
    const config = loadConfig('/valid/path.json');
    
    // 個別設定があるツールはそちらを優先
    expect(config.read?.mode).toBe('count_only');
    
    // 未指定のツールはdefaultキーの設定にフォールバックされる
    expect(config.bash?.mode).toBe('lines');
    expect(config.bash?.outputLines).toBe(3);
    expect(config.bash?.noPadding).toBe(false);
    expect(config.write?.mode).toBe('lines');
  });

  it('should handle symbol and standard object properties safely', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      default: { mode: 'lines' }
    }));

    const config = loadConfig('/valid/path.json');
    
    // symbol properties should not trigger fallback
    const sym = Symbol('test');
    expect((config as any)[sym]).toBeUndefined();

    // toJSON and then should return undefined
    expect((config as any).toJSON).toBeUndefined();
    expect((config as any).then).toBeUndefined();
  });
});

describe('getEffectiveToolName', () => {
  it('should return original toolName if args are not provided or not object', () => {
    expect(getEffectiveToolName('bash', null)).toBe('bash');
    expect(getEffectiveToolName('bash', 'string')).toBe('bash');
  });

  it('should return prefixed toolName for non-mcp tools with tool or action argument', () => {
    expect(getEffectiveToolName('gateway', { tool: 'my_tool' })).toBe('gateway:my_tool');
    expect(getEffectiveToolName('gateway', { action: 'my_action' })).toBe('gateway:my_action');
    expect(getEffectiveToolName('gateway', { other: 'args' })).toBe('gateway');
  });

  it('should parse mcp tool arguments specifically', () => {
    expect(getEffectiveToolName('mcp', { action: 'run' })).toBe('mcp:run');
    expect(getEffectiveToolName('mcp', { tool: 'search' })).toBe('mcp:search');
    expect(getEffectiveToolName('mcp', { connect: 'server' })).toBe('mcp:connect');
    expect(getEffectiveToolName('mcp', { describe: 'tool' })).toBe('mcp:describe');
    expect(getEffectiveToolName('mcp', { search: 'query' })).toBe('mcp:search');
    expect(getEffectiveToolName('mcp', { server: 'list' })).toBe('mcp:list');
    expect(getEffectiveToolName('mcp', { other: 'args' })).toBe('mcp:status');
  });
});

describe('resolveToolConfig', () => {
  it('should fall back to original tool name config if specific is not found', () => {
    const config = {
      bash: { mode: 'lines' as const },
      'gateway:my_tool': { mode: 'count_only' as const }
    };
    expect(resolveToolConfig('bash', { tool: 'other' }, config).mode).toBe('lines');
    expect(resolveToolConfig('gateway', { tool: 'my_tool' }, config).mode).toBe('count_only');
  });

  it('should resolve mcp proxy tool config via the proxy pattern', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      'mcp:tavily_tavily_search': { mode: 'lines', outputLines: 0, noPadding: true },
      default: { mode: 'count_only' }
    }));

    const config = loadConfig('/valid/path.json');
    
    // MCP proxy tool call: toolName="mcp", args.tool="tavily_tavily_search"
    const result = resolveToolConfig('mcp', { tool: 'tavily_tavily_search', args: '{}' }, config);
    expect(result.mode).toBe('lines');
    expect(result.outputLines).toBe(0);
    expect(result.noPadding).toBe(true);
  });

  it('should fall back to default for mcp:status when not configured', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      'mcp:tavily_tavily_search': { mode: 'lines' },
      default: { mode: 'count_only' }
    }));

    const config = loadConfig('/valid/path.json');
    
    // MCP status action: no specific config
    const result = resolveToolConfig('mcp', { other: 'args' }, config);
    expect(result.mode).toBe('count_only'); // falls back to default
  });

  it('should resolve mcp direct tool (without proxy) via mcp:toolname', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      'mcp:my_tool': { mode: 'lines' },
    }));

    const config = loadConfig('/valid/path.json');
    
    // Direct mcp call pattern
    const result = resolveToolConfig('mcp', { tool: 'my_tool' }, config);
    expect(result.mode).toBe('lines');
  });
});
