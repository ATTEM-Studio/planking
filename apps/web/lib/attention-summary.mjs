export function buildAttentionCopy({ rising = 0, falling = 0, successRate = 0 }) {
  if (falling > 0) return { tone: 'danger', title: `${falling}개 키워드가 하락했습니다`, body: rising > 0 ? `${rising}개는 상승했습니다. 하락한 키워드부터 확인하세요.` : '하락한 키워드부터 순위 흐름을 확인하세요.' };
  if (rising > 0) return { tone: 'success', title: `${rising}개 키워드가 상승했습니다`, body: successRate === 100 ? '모든 키워드의 최근 측정이 완료되었습니다.' : `최근 관측률은 ${successRate}%입니다.` };
  if (successRate === 0) return { tone: 'neutral', title: '아직 순위 측정이 없습니다', body: '업체와 키워드를 등록한 뒤 수집 작업을 실행하면 측정 결과와 변화가 표시됩니다.' };
  return { tone: 'neutral', title: '눈에 띄는 순위 변화가 없습니다', body: `최근 관측률은 ${successRate}%입니다. 키워드별 현황을 확인하세요.` };
}
