import { devices, expect, test } from '@playwright/test';

const SHOTS = process.env.FORLA_SHOTS;

/**
 * Deux « téléphones » (contextes de navigateur isolés) reliés par le relais réel :
 * création du foyer, invitation, puis synchronisation automatique dans les deux sens.
 */
test('deux appareils se synchronisent automatiquement', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'Scénario à deux appareils exécuté une seule fois');
  test.setTimeout(240_000);

  const phoneA = await browser.newContext({ locale: 'fr-FR' });
  const phoneB = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
  const a = await phoneA.newPage();
  const b = await phoneB.newPage();
  const sent: string[] = [];
  for (const p of [a, b]) p.on('request', (r) => r.url().includes('/v1/push') && sent.push(r.postData() ?? ''));

  // Téléphone A : foyer de démonstration, activation de la synchronisation
  await a.goto('./');
  await a.getByRole('button', { name: 'Essayer la démo' }).click();
  await expect(a.getByText('Reste à vivre ce mois-ci')).toBeVisible();
  await a.goto('./#/reglages');
  await a.getByRole('button', { name: 'Activer et inviter un appareil' }).click();
  await expect(a.getByRole('img', { name: 'QR code d’invitation' }).or(a.getByRole('img', { name: "QR code d'invitation" }))).toBeVisible({ timeout: 60_000 });
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/sync-invitation.png` });
  await a.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
  await expect(a.getByText(/^Synchronisé/).first()).toBeVisible({ timeout: 90_000 });
  const secret = await a.evaluate(() => JSON.parse(localStorage.getItem('forla.sync')!).secret as string);

  // Téléphone B : ouverture du lien d'invitation
  await b.goto(`./#/rejoindre?c=${secret}`);
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/sync-rejoindre.png` });
  await b.getByRole('button', { name: 'Rejoindre le foyer' }).click();
  await expect(b.getByText(/Bienvenue dans « Foyer Martin »/)).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/sync-qui.png` });
  await b.getByRole('button', { name: /Sacha/ }).click();
  await expect(b.getByRole('heading', { name: /Sacha/ })).toBeVisible();
  await b.goto('./#/operations');
  await b.getByRole('button', { name: 'Tout afficher' }).click();
  await expect(b.getByRole('button', { name: /Boulangerie Paul/ })).toBeVisible();

  // B ajoute une dépense → elle apparaît toute seule sur A
  await a.goto('./#/operations');
  await b.keyboard.press('n');
  const dialog = b.locator('dialog[open]');
  await dialog.getByLabel('Montant').fill('23,45');
  await dialog.getByLabel(/Bénéficiaire/).fill('Fleuriste du marché');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(a.getByRole('button', { name: /Fleuriste du marché/ })).toBeVisible({ timeout: 45_000 });
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/sync-recu-sur-A.png` });

  // A supprime une opération → elle disparaît toute seule sur B
  await a.getByRole('button', { name: /Boulangerie Paul/ }).click();
  await a.locator('dialog[open]').getByRole('button', { name: 'Supprimer' }).click();
  await expect(b.getByRole('button', { name: /Boulangerie Paul/ })).toHaveCount(0, { timeout: 45_000 });

  // Le relais ne reçoit que des données chiffrées : aucun texte lisible ne quitte les téléphones
  expect(sent.length).toBeGreaterThan(0);
  const all = sent.join(' ');
  for (const clear of ['Foyer Martin', 'Boulangerie', 'Fleuriste', 'Camille', 'Courses', 'Loyer']) expect(all).not.toContain(clear);

  await phoneA.close();
  await phoneB.close();
});
