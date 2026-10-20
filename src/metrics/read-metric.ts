import { Registry } from 'prom-client';

// Registry에서 이름과 라벨이 일치하는 값 하나를 읽는다. 없으면 0. histogram은 `_count`처럼 접미사까지 준다.
export async function readMetric(
  registry: Registry,
  name: string,
  labels: Record<string, string> = {},
): Promise<number> {
  const base = name.replace(/_(count|sum|bucket)$/, '');
  const metric =
    registry.getSingleMetric(name) ?? registry.getSingleMetric(base);
  if (!metric) {
    return 0;
  }
  const { values } = await metric.get();
  const sample = values.find(
    (v) =>
      ((v as { metricName?: string }).metricName ?? name) === name &&
      Object.entries(labels).every(
        ([k, value]) => (v.labels as Record<string, unknown>)[k] === value,
      ),
  );
  return sample?.value ?? 0;
}
