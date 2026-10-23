"use client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { HtmlWidget } from "./HtmlWidget";
import type { ChartSpec } from "@/lib/types";

const palette = (i: number) => `var(--chart-${(i % 5) + 1})`;
// ChartContainer exposes each config key as --color-<key>; keys must be CSS-safe.
const cssKey = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, "_");

export const fmt = (v: unknown, unit?: string) => {
  if (typeof v !== "number") return String(v ?? "");
  const n = Intl.NumberFormat("en-US", {
    notation: Math.abs(v) >= 1e5 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(v);
  return unit === "USD" ? `$${n}` : unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : n;
};

const pretty = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const shortTick = (v: unknown) => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}/.test(s) ? s.slice(5) : s.length > 12 ? `${s.slice(0, 11)}…` : s;
};

export function ChartView({ spec, height }: { spec: ChartSpec; height?: number }) {
  const { type, data = [], unit, variant } = spec;
  const h = height ?? spec.height ?? 240;

  if (type === "html") return <HtmlWidget html={spec.html ?? ""} data={data} height={h} />;

  const xKey = spec.xKey ?? Object.keys(data[0] ?? {})[0];
  const yKeys = spec.yKeys?.length
    ? spec.yKeys
    : Object.keys(data[0] ?? {}).filter((k) => k !== xKey && typeof data[0]?.[k] === "number");

  if (type === "kpi") {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {data.map((d, i) => (
          <div key={i} className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">{String(d.label ?? d[xKey] ?? "")}</div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight">{fmt(d.value ?? d[yKeys[0]], (d.unit as string) || unit)}</div>
            {d.delta != null && (
              <div className={`text-xs ${Number(d.delta) >= 0 ? "text-success" : "text-destructive"}`}>
                {Number(d.delta) >= 0 ? "▲" : "▼"} {fmt(Math.abs(Number(d.delta)), "%")}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (type === "table") {
    const cols = Object.keys(data[0] ?? {});
    return (
      <div className="overflow-auto" style={{ maxHeight: h + 80 }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr>{cols.map((c) => <th key={c} className="text-left font-medium text-muted-foreground border-b px-2 py-1.5">{pretty(c)}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                {cols.map((c) => (
                  <td key={c} className={`px-2 py-1.5 ${typeof r[c] === "number" ? "text-right tabular-nums" : ""}`}>
                    {fmt(r[c], typeof r[c] === "number" ? unit : undefined)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Pie: one config entry per slice so ChartLegendContent / tooltip pick up colours + labels.
  if (type === "pie") {
    const valueKey = yKeys[0];
    const slices = data.map((d, i) => ({ ...d, __key: cssKey(String(d[xKey])), fill: `var(--color-${cssKey(String(d[xKey]))})`, __i: i }));
    const config: ChartConfig = {
      [valueKey]: { label: pretty(valueKey) },
      ...Object.fromEntries(slices.map((s, i) => [s.__key, { label: String(data[i][xKey]), color: palette(s.__i) }])),
    };
    return (
      <ChartContainer config={config} className="mx-auto aspect-square w-full" style={{ maxHeight: h }}>
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="__key" />} />
          <Pie data={slices} dataKey={valueKey} nameKey="__key" innerRadius={variant === "labels" ? 0 : "70%"} strokeWidth={4}>
            {slices.map((s) => <Cell key={s.__key} fill={s.fill} />)}
            {variant === "labels" && <LabelList dataKey={valueKey} className="fill-background" stroke="none" fontSize={11} formatter={(v: unknown) => fmt(v, unit)} />}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="__key" />} className="flex-wrap gap-2 *:basis-1/4 *:justify-center" />
        </PieChart>
      </ChartContainer>
    );
  }

  const keys = yKeys.map((k) => ({ raw: k, css: cssKey(k) }));
  const config: ChartConfig = Object.fromEntries(keys.map((k, i) => [k.css, { label: pretty(k.raw), color: palette(i) }]));
  // Re-key rows so dataKey matches the CSS-safe config keys.
  const rows = data.map((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k.css, d[k.raw]])) }));
  const single = keys.length === 1;
  const tooltip = (
    <ChartTooltip
      cursor={false}
      content={<ChartTooltipContent hideLabel={single} indicator={type === "line" ? "line" : "dot"} formatter={(v, name, item) => (
        <div className="flex w-full items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
          <span className="text-muted-foreground">{config[String(name)]?.label}</span>
          <span className="ml-auto font-mono font-medium tabular-nums text-foreground">{fmt(v, unit)}</span>
        </div>
      )} />}
    />
  );
  const legend = !single && <ChartLegend content={<ChartLegendContent />} />;
  // Areas always use the gradient fill and pies render as donuts (labels need a full pie).
  const curve = variant === "linear" ? "linear" : variant === "step" ? "step" : "natural";
  const labels = (k: string) =>
    variant === "labels" && <LabelList dataKey={k} position="top" offset={10} className="fill-foreground" fontSize={11} formatter={(v: unknown) => fmt(v, unit)} />;

  if (type === "bar" && variant === "horizontal") {
    return (
      <ChartContainer config={config} className="w-full" style={{ height: Math.max(h, rows.length * 32) }}>
        <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16 }}>
          <CartesianGrid horizontal={false} />
          <YAxis dataKey={xKey} type="category" tickLine={false} axisLine={false} tickMargin={8} width={110} tickFormatter={shortTick} />
          <XAxis type="number" hide />
          {tooltip}
          {legend}
          {keys.map((k) => (
            <Bar key={k.css} dataKey={k.css} fill={`var(--color-${k.css})`} radius={5}>
              {variant === "horizontal" && single && <LabelList dataKey={k.css} position="right" offset={8} className="fill-foreground" fontSize={11} formatter={(v: unknown) => fmt(v, unit)} />}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  const xAxis = <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortTick} />;
  const yAxis = <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmt(v, unit)} />;
  const margin = { left: 4, right: 12, top: variant === "labels" ? 20 : 8 };

  return (
    <ChartContainer config={config} className="w-full" style={{ height: h }}>
      {type === "line" ? (
        <LineChart accessibilityLayer data={rows} margin={margin}>
          <CartesianGrid vertical={false} />
          {xAxis}{yAxis}{tooltip}{legend}
          {keys.map((k) => (
            <Line key={k.css} dataKey={k.css} type={curve} stroke={`var(--color-${k.css})`} strokeWidth={2}
              dot={variant === "dots" || variant === "labels" ? { fill: `var(--color-${k.css})` } : false}
              activeDot={{ r: 5 }}>
              {labels(k.css)}
            </Line>
          ))}
        </LineChart>
      ) : type === "area" ? (
        <AreaChart accessibilityLayer data={rows} margin={margin}>
          <defs>
            {keys.map((k) => (
              <linearGradient key={k.css} id={`fill-${k.css}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${k.css})`} stopOpacity={0.8} />
                <stop offset="95%" stopColor={`var(--color-${k.css})`} stopOpacity={0.1} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          {xAxis}{yAxis}{tooltip}{legend}
          {keys.map((k) => (
            <Area key={k.css} dataKey={k.css} type={curve} stroke={`var(--color-${k.css})`}
              fill={`url(#fill-${k.css})`} fillOpacity={1} stackId={variant === "stacked" ? "a" : undefined} />
          ))}
        </AreaChart>
      ) : (
        <BarChart accessibilityLayer data={rows} margin={margin}>
          <CartesianGrid vertical={false} />
          {xAxis}{yAxis}{tooltip}{legend}
          {keys.map((k, i) => (
            <Bar key={k.css} dataKey={k.css} fill={`var(--color-${k.css})`}
              stackId={variant === "stacked" ? "a" : undefined}
              radius={variant === "stacked" ? (i === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : 6}>
              {labels(k.css)}
            </Bar>
          ))}
        </BarChart>
      )}
    </ChartContainer>
  );
}
