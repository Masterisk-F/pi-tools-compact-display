import { describe, it, expect } from 'vitest';
import { formatOutput } from '../src/renderUtils';
import { ToolConfig } from '../src/config';

describe('formatOutput', () => {
  it('should format output according to config in lines mode', () => {
    const input = "line1\n\nline2\n\nline3\nline4";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 2 };
    
    // Not expanded, limits to 2 lines and removes padding
    const res1 = formatOutput(input, config, false);
    expect(res1).toBe("line1\nline2");

    // Expanded, ignores outputLines but still applies padding removal
    // Actually, should it apply padding removal on expanded? The plan doesn't specify strictly,
    // but typically expanded means full output, though we might still want to trim empty lines.
    // Let's assume expanded = true returns all non-empty lines if noPadding is true.
    const res2 = formatOutput(input, config, true);
    expect(res2).toBe("line1\nline2\nline3\nline4");
  });

  it('should return empty array or string if no lines after padding removal', () => {
    const input = "\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 2 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should respect outputLines without noPadding', () => {
    const input = "line1\n\nline2\n\nline3\nline4";
    const config: ToolConfig = { mode: 'lines', outputLines: 3 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\n\nline2");
  });
  
  it('should return empty string when outputLines is 0', () => {
    const input = "line1\nline2\nline3";
    const config: ToolConfig = { mode: 'lines', outputLines: 0 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should handle noPadding with outputLines 0 - return empty', () => {
    const input = "\n\nline1\n\nline2\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 0 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should remove only leading/trailing/consecutive empty lines with noPadding', () => {
    const input = "\n\nline1\n\n\nline2\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 10 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\nline2");
  });

  it('should return input as-is for default mode', () => {
    const input = "line1\n\nline2";
    const config: ToolConfig = { mode: 'default' };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\n\nline2");
  });
});
