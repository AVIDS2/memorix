/**
 * RingBuffer — Bounded line buffer for agent process output.
 *
 * Captures the last N lines of stdout/stderr without unbounded memory growth.
 * Used by agent adapters to provide tail output for diagnostics.
 */

export class RingBuffer {
  private lines: string[] = [];

  constructor(private maxLines: number = 50) {}

  push(text: string): void {
    for (const line of text.split('\n')) {
      if (line.trim()) {
        this.lines.push(line);
        if (this.lines.length > this.maxLines) this.lines.shift();
      }
    }
  }

  getLines(): string[] {
    return [...this.lines];
  }

  toString(): string {
    return this.lines.join('\n');
  }

  get length(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
  }
}
