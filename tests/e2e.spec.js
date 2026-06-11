const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://usoirglmgylpyokmusez.supabase.co';

const MOCK_USER = { id: 'user-123', email: 'test@example.com', role: 'authenticated' };
const MOCK_SESSION = {
  access_token: 'fake-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh-token',
  user: MOCK_USER,
};
const MOCK_DEVICES = [
  { id: 1, user_id: 'user-123', device_id: 'ESP32-ABCD', plant_name: 'Living Room Fern', created_at: new Date().toISOString() },
];
const MOCK_READINGS = [
  { id: 1, device_id: 'ESP32-ABCD', moisture: 55, raw_adc: 2100, status: 'OK', created_at: new Date().toISOString() },
];

// Intercept all Supabase REST + auth calls
async function mockSupabase(page, { authenticated } = {}) {
  await page.route(`${SUPABASE_URL}/auth/v1/**`, async route => {
    const url = route.request().url();
    if (url.includes('logout')) {
      return route.fulfill({ status: 204, body: '' });
    }
    if (authenticated) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SESSION) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { session: null }, error: null }) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/devices**`, async route => {
    if (authenticated) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_DEVICES) });
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/readings**`, async route => {
    if (authenticated) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_READINGS) });
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([]),
  }));
}

// Seed localStorage with a fake session before page scripts run
async function seedSession(page) {
  const storageKey = `sb-usoirglmgylpyokmusez-auth-token`;
  await page.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: storageKey, session: MOCK_SESSION });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Unauthenticated', () => {
  test('shows login screen when no session exists', async ({ page }) => {
    await mockSupabase(page, { authenticated: false });
    await page.goto('/');
    await expect(page.locator('#screen-login')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#screen-dashboard')).not.toBeVisible();
  });

  test('login screen has email and password fields', async ({ page }) => {
    await mockSupabase(page, { authenticated: false });
    await page.goto('/');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
  });

  test('shows error on bad credentials', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/auth/v1/**`, route =>
      route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      })
    );
    await page.goto('/');
    await page.locator('#login-email').fill('wrong@example.com');
    await page.locator('#login-password').fill('badpass');
    await page.locator('#login-btn').click();
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { authenticated: true });
  });

  test('shows dashboard with device name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#active-plant-name')).toHaveText('Living Room Fern', { timeout: 5000 });
  });

  test('device list renders the mock device', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#device-list')).toContainText('Living Room Fern', { timeout: 5000 });
    await expect(page.locator('#device-list')).toContainText('ESP32-ABCD');
  });

  test('gauge shows moisture percentage from reading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gauge-pct')).toHaveText('55%', { timeout: 5000 });
  });

  test('active device is persisted to localStorage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 5000 });
    const saved = await page.evaluate(() => localStorage.getItem('moist_active_device'));
    expect(saved).toBe('ESP32-ABCD');
  });

  test('sign out clears session from localStorage and shows login', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 5000 });

    // Sign out — the page will reload
    await Promise.all([
      page.waitForNavigation(),
      page.locator('[title="Sign out"]').click(),
    ]);

    // After reload with no session, login screen should show
    await mockSupabase(page, { authenticated: false });
    await expect(page.locator('#screen-login')).toBeVisible({ timeout: 5000 });

    // localStorage session key must be gone
    const session = await page.evaluate(() =>
      localStorage.getItem('sb-usoirglmgylpyokmusez-auth-token')
    );
    expect(session).toBeNull();
  });
});
