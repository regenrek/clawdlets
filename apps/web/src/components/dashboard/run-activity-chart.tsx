import * as React from "react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { formatShortDate } from "./dashboard-utils"
import type { RunRow } from "./recent-runs-table"

export function RunActivityChart(props: { runs: RunRow[] }) {
  const data = React.useMemo(() => {
    const days = 14
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))

    const buckets = new Map<string, { date: string; succeeded: number; failed: number; other: number }>()
    for (let i = 0; i < days; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, { date: key, succeeded: 0, failed: 0, other: 0 })
    }

    for (const r of props.runs) {
      const key = new Date(r.startedAt).toISOString().slice(0, 10)
      const b = buckets.get(key)
      if (!b) continue
      if (r.status === "succeeded") b.succeeded += 1
      else if (r.status === "failed") b.failed += 1
      else b.other += 1
    }

    return Array.from(buckets.values())
  }, [props.runs])

  const chartConfig = {
    succeeded: { label: "Succeeded", color: "var(--chart-2)" },
    failed: { label: "Failed", color: "var(--chart-5)" },
    other: { label: "Other", color: "var(--chart-3)" },
  } satisfies ChartConfig

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{
          left: 12,
          right: 12,
        }}
      >
        <defs>
          <linearGradient id="fillSucceeded" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-succeeded)" stopOpacity={0.8} />
            <stop offset="95%" stopColor="var(--color-succeeded)" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-failed)" stopOpacity={0.7} />
            <stop offset="95%" stopColor="var(--color-failed)" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="fillOther" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-other)" stopOpacity={0.6} />
            <stop offset="95%" stopColor="var(--color-other)" stopOpacity={0.1} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value) => {
            const ts = Date.parse(String(value))
            return Number.isFinite(ts) ? formatShortDate(ts) : String(value)
          }}
        />

        <ChartTooltip
          content={(tooltipProps: any) => (
            <ChartTooltipContent
              {...tooltipProps}
              className="w-[160px]"
              labelFormatter={(value) => {
                const ts = Date.parse(String(value))
                return Number.isFinite(ts)
                  ? new Date(ts).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : String(value)
              }}
            />
          )}
        />

        <Area
          type="monotone"
          dataKey="succeeded"
          stackId="a"
          stroke="var(--color-succeeded)"
          fill="url(#fillSucceeded)"
        />
        <Area
          type="monotone"
          dataKey="failed"
          stackId="a"
          stroke="var(--color-failed)"
          fill="url(#fillFailed)"
        />
        <Area
          type="monotone"
          dataKey="other"
          stackId="a"
          stroke="var(--color-other)"
          fill="url(#fillOther)"
        />
      </AreaChart>
    </ChartContainer>
  )
}
