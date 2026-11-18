export function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m * 10) / 10} min`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} d`;
}
