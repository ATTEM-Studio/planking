'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navigationItems = [
  { href: '/', label: '대시보드', icon: '⌂' },
  { href: '/admin', label: '관리', icon: '⚙' },
];

export function AppNavigation() {
  const pathname = usePathname();
  const isCurrent = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  const links = (variant: 'sidebar' | 'mobile') => navigationItems.map((item) => {
    const current = isCurrent(item.href);
    return <Link key={item.href} href={item.href} className={`navigation-link ${variant} ${current ? 'is-current' : ''}`} aria-current={current ? 'page' : undefined}>
      <span aria-hidden="true" className="navigation-icon">{item.icon}</span>
      <span>{item.label}</span>
    </Link>;
  });

  return <>
    <aside className="app-sidebar">
      <Link href="/" className="brand" aria-label="PLANKING 대시보드">
        <span className="brand-mark">P</span>
        <span><b>PLANKING</b><small>PLACE INTELLIGENCE</small></span>
      </Link>
      <nav aria-label="주요 메뉴" className="sidebar-navigation">{links('sidebar')}</nav>
    </aside>
    <nav aria-label="모바일 주요 메뉴" className="mobile-navigation">{links('mobile')}</nav>
  </>;
}
