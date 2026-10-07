import Link from 'next/link';
import { requireStaff } from '../../lib/access';

export default async function AdminPage() {
  await requireStaff();

  return <main className="page-shell">
    <section className="hero">
      <p className="eyebrow">관리</p>
      <h1>관리</h1>
      <p className="muted">추적에 필요한 업체, 키워드, 접근 권한과 수집 결과를 관리합니다.</p>
    </section>
    <section className="admin-grid" aria-label="관리 메뉴">
      <Link className="admin-tile" href="/admin/clients">
        <b>클라이언트</b>
        <span>클라이언트와 조회 대상을 등록하고 권한을 연결합니다.</span>
      </Link>
      <Link className="admin-tile" href="/admin/places">
        <b>업체와 키워드</b>
        <span>업체와 키워드를 등록해 순위 추적을 시작합니다.</span>
      </Link>
      <Link className="admin-tile" href="/admin/jobs">
        <b>수집 작업</b>
        <span>수집 결과와 확인이 필요한 작업을 점검합니다.</span>
      </Link>
    </section>
  </main>;
}
