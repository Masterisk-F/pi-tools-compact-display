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
});
