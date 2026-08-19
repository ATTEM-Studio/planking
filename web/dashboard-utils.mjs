export function formatScore(value) {
  return value === null || value === undefined ? '—' : String(Math.round(Number(value)));
}

export function scoreTone(value) {
  if (value === null || value === undefined) return 'neutral';
  const score = Number(value);
  if (score >= 80) return 'strong';
  if (score >= 50) return 'mid';
  return 'weak';
}

export function confidenceLabel(value) {
  return ({ high: '높음', medium: '보통', low: '실험' })[value] || '실험';
}
