import { requestMagicLink } from './actions';
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">P</div><p className="eyebrow">GRION · PLACE INTELLIGENCE</p><h1>PLANKING</h1><p className="muted">네이버 플레이스 순위 변화를 한 곳에서 확인합니다.</p><form action={requestMagicLink} className="stack"><label htmlFor="email">이메일</label><input id="email" name="email" type="email" required placeholder="name@company.com"/><button type="submit">로그인 링크 받기</button></form>{params.sent === '1' && <p className="notice success">이메일로 로그인 링크를 보냈습니다.</p>}{params.error && <p className="notice error">로그인 요청을 처리하지 못했습니다.</p>}</section></main>;
}
