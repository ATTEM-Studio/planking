import { chromium } from 'playwright';

const keyword = process.env.KEYWORD || '하단역카페';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

try {
  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3500);

  const frame = page.frameLocator('#searchIframe');
  const controls = await frame.locator('a,button').evaluateAll((nodes) => nodes.map((node) => ({
    tag: node.tagName,
    text: (node.textContent || '').trim(),
    ariaLabel: node.getAttribute('aria-label'),
    title: node.getAttribute('title'),
    role: node.getAttribute('role'),
    className: node.className,
    disabled: 'disabled' in node ? Boolean(node.disabled) : null,
  })).filter((row) => row.text || row.ariaLabel || row.title));

  const paginationLike = controls.filter((row) => {
    const haystack = `${row.text} ${row.ariaLabel || ''} ${row.title || ''}`.toLowerCase();
    return /^\d+$/.test(row.text) || haystack.includes('다음') || haystack.includes('페이지') || haystack.includes('next');
  });

  console.log('PAGINATION_CONTROLS', JSON.stringify(paginationLike, null, 2));
  console.log('EXACT_2_LINK_COUNT', await frame.getByRole('link', { name: '2', exact: true }).count());
  console.log('TEXT_2_COUNT', await frame.getByText('2', { exact: true }).count());
  console.log('NEXT_LINK_COUNT', await frame.getByRole('link', { name: /다음|next/i }).count());
  console.log('NEXT_BUTTON_COUNT', await frame.getByRole('button', { name: /다음|next/i }).count());
} finally {
  await context.close();
  await browser.close();
}
