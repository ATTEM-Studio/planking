import { buildAttentionCopy } from '../../lib/attention-summary.mjs';

export function AttentionSummary({ totals }: { totals: { rising: number; falling: number; successRate: number } }) {
  const copy = buildAttentionCopy(totals);
  return <section className={`attention-summary ${copy.tone}`} aria-label="순위 변화 요약">
    <div><p className="eyebrow">오늘의 변화</p><h2>{copy.title}</h2><p>{copy.body}</p></div>
    <div className="attention-counts" aria-label={`상승 ${totals.rising}개, 하락 ${totals.falling}개`}><span>▲ {totals.rising}</span><span>▼ {totals.falling}</span></div>
  </section>;
}
