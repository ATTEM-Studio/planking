import type { Metadata } from 'next'; import { AppNavigation } from '../components/layout/AppNavigation'; import './globals.css'; import './redesign.css'; import './dashboard.css'; import './admin.css';

export const dynamic = 'force-dynamic';
export const metadata:Metadata={title:'PLANKING',description:'네이버 플레이스 순위 추적 대시보드'}; export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><body><div className="app-shell"><AppNavigation/><div className="app-content">{children}</div></div></body></html>;}
