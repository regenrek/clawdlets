import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"

export function KpiCard(props: { title: string; value: string; subtext: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
        <CardDescription>{props.subtext}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-black tracking-tight tabular-nums">{props.value}</div>
      </CardContent>
    </Card>
  )
}
