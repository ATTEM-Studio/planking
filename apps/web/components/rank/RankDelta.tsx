export function RankDelta({delta}:{delta:{label:string;direction:string}}){return <span className={`rank-delta ${delta.direction}`}>{delta.label}</span>;}
