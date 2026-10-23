"use client";
import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { ChartView } from "./ChartView";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChartSpec } from "@/lib/types";

/** shadcn "charts" card layout: header (title + description), chart, then a divider and trend footer on the card background. */
export function ChartCard({ spec, action, className = "" }: { spec: ChartSpec; action?: ReactNode; className?: string }) {
  const bare = spec.type === "kpi";
  const up = (spec.trend?.value ?? 0) >= 0;
  return (
    <Card className={`gap-5 py-5 ${className}`}>
      <CardHeader>
        <CardTitle className="text-base">{spec.title}</CardTitle>
        {spec.description && <CardDescription>{spec.description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={bare ? "" : "px-2 sm:px-4"}>
        <ChartView spec={spec} />
      </CardContent>
      {(spec.trend || spec.footnote) && (
        <CardFooter className="flex-col items-start gap-1.5 bg-transparent pt-4 pb-5 text-sm">
          {spec.trend && (
            <div className="flex items-center gap-2 font-medium leading-none">
              Trending {up ? "up" : "down"} by {Math.abs(spec.trend.value).toFixed(1)}%{spec.trend.label ? ` ${spec.trend.label}` : ""}
              {up ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-destructive" />}
            </div>
          )}
          {spec.footnote && <div className="leading-none text-muted-foreground">{spec.footnote}</div>}
        </CardFooter>
      )}
    </Card>
  );
}
