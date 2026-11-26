import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.FORLA_SHOTS;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('création du foyer, saisie rapide et catégorisation automatique', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer mon foyer' }).click();
  await page.getByLabel('Prénom du membre 1').fill('Lou');
  await page.getByRole('button', { name: 'Ajouter un membre' }).click();
  await page.getByLabel('Prénom du membre 2').fill('Noa');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Solde actuel').fill('1 500');
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByRole('heading', { name: /Bonjour|Bonsoir|Bonne nuit/ })).toBeVisible();

  // Nouvelle dépense avec calcul + règle "carrefour" → Courses
  await page.keyboard.press('n');
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Montant').fill('12,40+7,60');
  await dialog.getByLabel(/Bénéficiaire/).fill('CB Carrefour City');
  await dialog.getByLabel(/Bénéficiaire/).blur();
  await expect(dialog.getByLabel('Toutes les catégories')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('Toutes les catégories').locator('option:checked')).toHaveText(/Courses/);
  await dialog.getByRole('button', { name: 'Noa' }).click();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(/Dépense de 20,00/)).toBeVisible();

  await page.goto('/#/operations');
  await expect(page.getByRole('button', { name: /CB Carrefour City/ })).toBeVisible();

  // Le partage à parts égales crée une dette de Lou envers Noa
  await page.goto('/#/foyer');
  await expect(page.getByText('Lou rembourse')).toContainText('10,00');
  expect(errors).toEqual([]);
});

test('fonctionne hors connexion après la première visite', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Essayer la démo' }).click();
  await expect(page.getByText('Reste à vivre ce mois-ci')).toBeVisible();
  // Attendre que le service worker contrôle la page
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Reste à vivre ce mois-ci')).toBeVisible();
  await page.goto('/#/analyses');
  await expect(page.getByRole('heading', { name: 'Analyses' })).toBeVisible();
  await expect(page.getByText('Dépenses par catégorie')).toBeVisible();
  await context.setOffline(false);
});

test('parcours visuel de toutes les pages (démo)', async ({ page }, info) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Essayer la démo' }).click();
  await expect(page.getByText('Reste à vivre ce mois-ci')).toBeVisible();
  const pages = ['', 'operations', 'budget', 'echeancier', 'comptes', 'foyer', 'objectifs', 'analyses', 'reglages'];
  for (const p of pages) {
    await page.goto(`/#/${p}`);
    await page.waitForTimeout(350);
    await expect(page.locator('main h1').first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${p || 'accueil'}.png`, fullPage: true });
  }
  // Mode sombre
  await page.evaluate(() => localStorage.setItem('forla.theme', 'dark'));
  await page.goto('/#/');
  await page.reload();
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-accueil-sombre.png`, fullPage: true });
  // Feuille de saisie
  await page.goto('/#/operations');
  await page.getByRole('button', { name: /Ajouter|Nouvelle opération/ }).first().click();
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-saisie.png` });
  expect(errors).toEqual([]);
});
