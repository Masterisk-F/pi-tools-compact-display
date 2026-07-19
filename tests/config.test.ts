import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config';
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
