import { ToolConfig } from './config';

export function formatOutput(input: string, config: ToolConfig, expanded: boolean): string {
  if (config.mode !== 'lines') {
    return input;
  }

  let lines = input.split('\n');

  if (config.noPadding) {
    lines = lines.filter(line => line.trim() !== '');
  }

  if (!expanded && config.outputLines !== undefined) {
    lines = lines.slice(0, config.outputLines);
  } else if (expanded) {
    // 全文表示時の上限（プランに記載の通り上限ありとする、例えば 1000行）
    lines = lines.slice(0, 1000);
  }

  return lines.join('\n');
}
