import type { Metadata } from 'next'; import Link from 'next/link'; import './globals.css'; import './admin.css';

export const dynamic = 'force-dynamic';
export const metadata:Metadata={title:'PLANKING',description:'네이버 플레이스 순위 추적 대시보드'}; export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><body><header className="topbar"><Link href="/" className="brand"><span className="brand-mark small">P</span><span><b>PLANKING</b><small>GRION PLACE INTELLIGENCE</small></span></Link><nav><Link href="/">대시보드</Link><Link href="/admin">관리</Link></nav></header>{children}</body></html>;}
