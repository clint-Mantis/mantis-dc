import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const PASSWORD = 'DemoPass123!';
async function login(page: Page, who: 'admin' | 'consultant' | 'editor' | 'viewer' | 'verifier') {
  await page.goto('/');
  await page.getByLabel('Email').fill(`${who}@demo.local`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Mantis Data Capture')).toBeVisible();
}
async function openProject(page: Page) {
  await page.getByRole('link', { name: /FY2026/ }).first().click();
  await expect(page.getByText('General project evidence')).toBeVisible();
}

test('Gate 1: viewer sees masked data and cannot capture', async ({ page }) => {
  await login(page, 'viewer');
  await openProject(page);
  await page.getByRole('link', { name: 'Management Control' }).click();
  await expect(page.getByText(/\*{9}\d{4}/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add' })).toHaveCount(0);
});

test('Gate 2: capture, edit, import and export in a pillar', async ({ page }) => {
  await login(page, 'editor');
  await openProject(page);
  await page.getByRole('link', { name: 'Ownership' }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByLabel(/Shareholder \/ Organisation Name/).fill('E2E Holdings');
  await page.getByLabel('Category').selectOption('organisation');
  await page.getByLabel(/% Organisation Owned by Black People/).fill('60');
  await page.getByRole('button', { name: 'Add row' }).click();
  await expect(page.getByText('Row added')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('cell', { name: 'E2E Holdings' })).toBeVisible();
  // import
  writeFileSync('/tmp/e2e-own.csv', 'Category,Sharholder Name,Number of Shares\nindividual,Imported Person,100\n');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Choose file').setInputFiles('/tmp/e2e-own.csv');
  await page.getByRole('button', { name: 'Check rows' }).click();
  await page.getByRole('button', { name: /Import 1 valid rows/ }).click();
  await expect(page.getByText(/1<\/b>? rows imported|rows imported/)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).last().click();
  // export
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XLSX' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.xlsx$/);
});

test('Gate 3: verification cycle', async ({ browser }) => {
  const verifier = await (await browser.newContext()).newPage();
  await login(verifier, 'verifier');
  await openProject(verifier);
  await verifier.getByRole('link', { name: 'Management Control' }).click();
  await verifier.getByLabel('Select row').first().check();
  await verifier.getByRole('button', { name: 'Sample selected' }).click();
  await verifier.getByRole('button', { name: 'Open' }).first().click();
  await verifier.getByRole('tab', { name: /Queries/ }).click();
  await verifier.getByLabel('Raise a query').fill('Please upload the appointment letter');
  await verifier.getByRole('button', { name: 'Raise query' }).click();

  const editor = await (await browser.newContext()).newPage();
  await login(editor, 'editor');
  await openProject(editor);
  await editor.getByRole('link', { name: /Samples/ }).click();
  await editor.getByRole('button', { name: /1 open/ }).click();
  await editor.getByPlaceholder('Your answer…').fill('Uploaded to the evidence tab');
  await editor.getByRole('button', { name: 'Answer' }).click();
  await editor.getByRole('tab', { name: /Evidence/ }).click();
  writeFileSync('/tmp/e2e-letter.pdf', '%PDF-1.4\n%e2e\n');
  await editor.locator('input[type=file]').setInputFiles('/tmp/e2e-letter.pdf');
  await expect(editor.getByText('1 file uploaded')).toBeVisible();

  await verifier.reload();
  await verifier.getByRole('button', { name: 'Open' }).first().click();
  await verifier.getByRole('tab', { name: /Queries/ }).click();
  await verifier.getByRole('button', { name: 'Close query' }).click();
  await verifier.keyboard.press('Escape');
  await verifier.getByLabel('Select row').first().check();
  await verifier.getByRole('button', { name: 'Mark verified' }).click();

  const consultant = await (await browser.newContext()).newPage();
  await login(consultant, 'consultant');
  await openProject(consultant);
  await consultant.getByRole('button', { name: 'Lock' }).nth(2).click();
  await expect(consultant.getByText('Pillar locked')).toBeVisible();
});
