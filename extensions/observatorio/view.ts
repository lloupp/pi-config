import { basename, dirname } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Observatory, starsFor, type Call, type Star } from "./model.ts";

type Color = "accent" | "dim" | "muted" | "success" | "error" | "warning" | "text" | "border";
type Cell = { char: string; color: Color };
export interface ViewOptions {
  theme: Pick<Theme, "fg" | "bold">;
  height: () => number;
  redraw: () => void;
  close: () => void;
  // Injectable scheduler keeps timer lifecycle tests deterministic.
  schedule?: (tick: () => void) => () => void;
}

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
const statusText = (call: Call) => ({ running: "em execução", success: "concluída", error: "falhou", unknown: "sem resultado registrado" })[call.outcome];

export class ObservatoryView {
  private model: Observatory;
  private options: ViewOptions;
  private stopTimer?: () => void;
  private disposed = false;
  private paused = false;
  private frame = 0;
  private replay?: Call[];
  private cursor = 0;
  private selectedKey?: string;

  constructor(model: Observatory, options: ViewOptions) {
    this.model = model;
    this.options = options;
    this.syncTimer();
  }

  private syncTimer(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
    if (this.paused || this.disposed) return;
    const schedule = this.options.schedule ?? ((tick: () => void) => {
      const timer = setInterval(tick, 100);
      return () => clearInterval(timer);
    });
    this.stopTimer = schedule(() => {
      if (this.disposed || this.paused) return;
      this.frame++;
      if (this.replay && this.frame % 4 === 0) {
        this.cursor = Math.min(this.cursor + 1, this.replay.length);
        this.selectedKey = undefined;
        if (this.cursor === this.replay.length) {
          this.paused = true;
          this.syncTimer();
        }
      }
      this.options.redraw();
    });
  }

  private visibleCalls(): Call[] {
    return this.replay ? this.replay.slice(0, this.cursor) : this.model.calls;
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
      this.dispose();
      this.options.close();
      return;
    }
    if (data === "r") {
      this.replay = this.model.calls.map(call => ({ ...call }));
      this.cursor = Math.min(1, this.replay.length);
      this.selectedKey = undefined;
      this.paused = this.replay.length <= 1;
      this.frame = 0;
      this.syncTimer();
    } else if (data === "v") {
      this.replay = undefined;
      this.selectedKey = undefined;
      this.paused = false;
      this.syncTimer();
    } else if (matchesKey(data, "space")) {
      this.paused = !this.paused;
      this.syncTimer();
    } else if (matchesKey(data, "left") || matchesKey(data, "right")) {
      if (!this.replay) {
        this.replay = this.model.calls.map(call => ({ ...call }));
        this.cursor = this.replay.length;
      }
      this.cursor = Math.max(0, Math.min(this.replay.length, this.cursor + (matchesKey(data, "left") ? -1 : 1)));
      this.paused = true;
      this.selectedKey = undefined;
      this.syncTimer();
    } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const stars = starsFor(this.visibleCalls());
      const index = this.selection(stars);
      const next = (index + (matchesKey(data, "up") ? -1 : 1) + stars.length) % stars.length;
      this.selectedKey = stars[next]?.key;
    }
    this.options.redraw();
  }

  private selection(stars: Star[]): number {
    const found = stars.findIndex(star => star.key === this.selectedKey);
    if (found >= 0) return found;
    const last = this.visibleCalls().at(-1);
    const recent = last && stars.findIndex(star => star.key === `${last.file ? "file" : "tool"}:${last.target}`);
    return typeof recent === "number" && recent >= 0 ? recent : Math.max(0, stars.length - 1);
  }

  render(width: number): string[] {
    const height = Math.max(1, this.options.height());
    const w = Math.max(0, width);
    const th = this.options.theme;
    if (w < 6 || height < 8) return [truncateToWidth("Observatório · Esc sai", w)];
    const inner = w - 4;
    const calls = this.visibleCalls();
    const stars = starsFor(calls);
    const selected = stars[this.selection(stars)];
    const failed = calls.filter(call => call.outcome === "error").length;
    const active = calls.filter(call => call.outcome === "running").length;
    const mode = this.replay ? `REPLAY ${this.cursor}/${this.replay.length}` : "AO VIVO";
    const badge = this.paused ? "PAUSADO" : active ? `${active} em execução` : "";
    const content: string[] = [];
    const styled = (color: Color, text: string) => th.fg(color, text);
    const row = (text: string) => {
      const clipped = truncateToWidth(text, inner, "…");
      return styled("border", "│ ") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + styled("border", " │");
    };
    content.push(styled("accent", "╭" + "─".repeat(w - 2) + "╮"));
    content.push(row(th.bold(styled("accent", "OBSERVATÓRIO")) + styled("muted", `  ${mode} ${badge}`)));
    content.push(row(`${stars.filter(star => star.file).length} arquivos · ${calls.length} chamadas · ` + styled(failed ? "error" : "success", `${failed} falhas`)));

    // The map takes all the height left by the header and the details; very short
    // terminals still keep the controls.
    const mapHeight = Math.max(0, height - 14);
    if (mapHeight >= 3 && inner >= 12) {
      const grid: Cell[][] = Array.from({ length: mapHeight }, () => Array.from({ length: inner }, () => ({ char: " ", color: "dim" as Color })));
      const put = (x: number, y: number, char: string, color: Color) => {
        if (grid[y]?.[x]) grid[y][x] = { char, color };
      };
      const center = { x: Math.floor(inner / 2), y: Math.floor(mapHeight / 2) };
      // Deterministic sky: resize never depends on Math.random().
      // Each point twinkles in its own phase, derived from the same hash.
      for (let i = 0; i < Math.floor(inner * mapHeight / 26); i++) {
        const seed = hash(`sky:${i}`);
        const phase = (this.frame + seed % 40) % 40;
        put(seed % inner, Math.floor(seed / inner) % mapHeight, phase < 30 ? "·" : phase < 34 ? "∙" : " ", "dim");
      }
      // Most recently used, not most recently discovered: an old file touched now must show.
      const shown = [...stars].sort((a, b) => a.last - b.last).slice(-Math.min(64, Math.floor(inner * mapHeight / 6)));
      if (selected && !shown.includes(selected)) shown[0] = selected;
      const occupied = new Set([`${center.x}:${center.y}`]);
      const points = new Map<string, { x: number; y: number }>();
      const groups = new Map<string, { x: number; y: number }[]>();
      for (const star of shown) {
        // Files of the same folder gather around one point, like a constellation; tools share another.
        const dir = star.file ? dirname(star.label) : undefined;
        const group = hash(dir === undefined ? "tools" : `dir:${dir}`);
        const seed = hash(star.key);
        let x = Math.max(0, Math.min(inner - 1, 4 + group % Math.max(1, inner - 8) + seed % 9 - 4));
        let y = Math.max(0, Math.min(mapHeight - 1, 1 + Math.floor(group / inner) % Math.max(1, mapHeight - 2) + Math.floor(seed / 9) % 3 - 1));
        while (occupied.has(`${x}:${y}`)) {
          x = (x + 1) % inner;
          if (x === 0) y = (y + 1) % mapHeight;
        }
        occupied.add(`${x}:${y}`);
        points.set(star.key, { x, y });
        const name = dir === undefined ? "ferramentas" : dir === "." ? "./" : `${basename(dir)}/`;
        groups.set(name, [...groups.get(name) ?? [], { x, y }]);
      }
      const line = (from: { x: number; y: number }, to: { x: number; y: number }, color: Color, path?: { x: number; y: number }[]) => {
        const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
        for (let step = 1; step < steps; step++) {
          const cell = { x: Math.round(from.x + (to.x - from.x) * step / steps), y: Math.round(from.y + (to.y - from.y) * step / steps) };
          put(cell.x, cell.y, "·", color);
          path?.push(cell);
        }
      };
      let previous = center;
      const trail: { x: number; y: number }[] = [];
      for (const call of calls.slice(-10)) {
        const point = points.get(`${call.file ? "file" : "tool"}:${call.target}`);
        if (point) {
          line(previous, point, "dim", trail);
          previous = point;
        }
      }
      // A comet runs the trail of the recent calls, oldest to newest, in a loop.
      if (trail.length) {
        const head = this.frame % trail.length;
        put(trail[head].x, trail[head].y, "•", "warning");
        if (head > 0) put(trail[head - 1].x, trail[head - 1].y, "∙", "muted");
      }
      const target = selected && points.get(selected.key);
      if (target) {
        line(center, target, "accent");
        const t = (this.frame % 24) / 24;
        put(Math.round(center.x + (target.x - center.x) * t), Math.round(center.y + (target.y - center.y) * t), "•", "accent");
      }
      // Constellation names go under (or over) their group, never over a star or another name.
      const named = new Set<string>();
      for (const [name, members] of groups) {
        const text = name.slice(0, 16);
        if ([...text].some(char => visibleWidth(char) !== 1)) continue;
        const ys = members.map(point => point.y);
        const y = Math.max(...ys) + 1 < mapHeight ? Math.max(...ys) + 1 : Math.min(...ys) - 1;
        const middle = members.reduce((sum, point) => sum + point.x, 0) / members.length;
        const x = Math.max(0, Math.min(inner - text.length, Math.round(middle - text.length / 2)));
        const cells = [...text].map((_, i) => `${x + i}:${y}`);
        if (y < 0 || text.length > inner || cells.some(cell => occupied.has(cell) || named.has(cell))) continue;
        cells.forEach(cell => named.add(cell));
        [...text].forEach((char, i) => put(x + i, y, char, "dim"));
      }
      put(center.x, center.y, "π", "accent");
      const last = calls.at(-1);
      const newest = last && `${last.file ? "file" : "tool"}:${last.target}`;
      const blink = Math.floor(this.frame / 2) % 2 === 1;
      const pulse = Math.floor(this.frame / 4) % 2 === 1;
      for (const star of shown) {
        const point = points.get(star.key)!;
        const color: Color = star.errors ? "error" : star.running ? "warning" : star === selected ? "accent" : star.changes ? "success" : "muted";
        const base = star.errors ? "!" : star.running ? (blink ? "*" : "+") : star.file ? "○" : "◇";
        const pulsing = star.key === newest && star !== selected && !star.errors && !star.running && pulse;
        put(point.x, point.y, star === selected ? "✦" : pulsing ? "✧" : base, pulsing ? "accent" : color);
      }
      for (const cells of grid) {
        let text = "";
        let run = "";
        let color = cells[0].color;
        for (const cell of cells) {
          if (cell.color !== color) { text += styled(color, run); run = ""; color = cell.color; }
          run += cell.char;
        }
        content.push(row(text + styled(color, run)));
      }
    }

    if (selected) {
      content.push(row(styled("accent", `✦ ${this.selection(stars) + 1}/${stars.length} `) + selected.label));
      content.push(row(selected.file
        ? `${selected.reads} leituras tentadas · ${selected.changes} alterações OK · ${selected.errors} falhas`
        : `${selected.calls.length} chamadas · ${selected.errors} falhas (argumentos ocultos)`));
      const recent = selected.calls.slice(-3).reverse();
      for (let i = 0; i < 3; i++) {
        const call = recent[i];
        content.push(row(call ? styled(i ? "muted" : "text", `${call.tool}: ${statusText(call)} · ${call.durationMs === undefined ? "duração indisponível" : `${call.durationMs} ms`}`) : ""));
      }
    } else {
      content.push(row(styled("accent", "O céu ainda está vazio.")));
      content.push(row("Use o pi: cada arquivo acessado vira uma estrela."));
      content.push(row("Só observação. Nenhuma ferramenta é reexecutada."));
      content.push(row(""));
      content.push(row(""));
    }
    const progress = this.replay ? this.cursor / Math.max(1, this.replay.length) : 1;
    const barWidth = Math.max(1, Math.min(inner - 8, 40));
    const filled = Math.floor(barWidth * progress);
    content.push(row(styled("accent", "━".repeat(filled)) + styled("dim", "─".repeat(barWidth - filled)) + styled("dim", this.replay ? " replay" : " sessão")));
    content.push(row(styled("dim", "○ arquivo  ◇ ferramenta  ! falha  ✦ seleção")));
    content.push(row(styled("muted", "↑↓ seleciona · ←→ passo · r replay")));
    content.push(row(styled("muted", "v ao vivo · espaço pausa · Esc sai")));
    content.push(row(styled("dim", `Últimas ${this.model.calls.length}/1000 chamadas · replay por ordem, não por tempo`)));
    content.push(styled("accent", "╰" + "─".repeat(w - 2) + "╯"));
    if (content.length > height) {
      // Keep title, selection and a close hint when the terminal is tiny.
      return [...content.slice(0, Math.max(1, height - 2)), row(styled("muted", "r replay · v vivo · Esc sai")), content.at(-1)!].slice(0, height);
    }
    return content;
  }

  invalidate(): void { /* Colors and geometry are recomputed on each render. */ }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer?.();
    this.stopTimer = undefined;
  }
}
