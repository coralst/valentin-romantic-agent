import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await p.getByTestId('app-layout').waitFor({ timeout: 15000 });
const input = p.getByRole('textbox');
for (const t of ["Her name's Samantha and she uses she/her. She's turning 32 in June."]) {
  await input.fill(t); await input.press('Enter'); await p.waitForTimeout(15000);
}
const dump = await p.evaluate(() => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.includes('profile') || k.includes('session')) out[k] = JSON.parse(localStorage.getItem(k)!);
  }
  return out;
});
console.log(JSON.stringify(dump, null, 1).slice(0, 6000));
await b.close();
