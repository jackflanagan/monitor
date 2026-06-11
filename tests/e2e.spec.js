const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'sb-usoirglmgylpyokmusez-auth-token';

const MOCK_USER    = { id: 'user-123', email: 'test@example.com', role: 'authenticated' };
const MOCK_SESSION = {
  access_token:  'fake-access-token',
  token_type:    'bearer',
  expires_in:    3600,
  expires_at:    Math.floor(Date.now() / 1000) + 7200,
  refresh_token: 'fake-refresh-token',
  user: MOCK_USER,
};
const MOCK_DEVICES = [
  { id: 1, user_id: 'user-123', device_id: 'ESP32-ABCD', plant_name: 'Living Room Fern', created_at: new Date().toISOString() },
];
const MOCK_READINGS = [
  { id: 1, device_id: 'ESP32-ABCD', moisture: 55, raw_adc: 2100, status: 'OK', created_at: new Date().toISOString() },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Replace the Supabase CDN script with a minimal mock that reads the session
// from localStorage (so doSignOut's localStorage.removeItem is respected) and
// returns hardcoded data for device/reading queries.
// No real Supabase network calls are made, so there's nothing to intercept.
function makeMockLib({ session = null, devices = [], readings = [], loginError = null } = {}) {
  return `!function(){
  var SESSION=${JSON.stringify(session)};
  var DEVICES=${JSON.stringify(devices)};
  var READINGS=${JSON.stringify(readings)};
  var LOGIN_ERROR=${JSON.stringify(loginError)};
  var KEY='${STORAGE_KEY}';
  localStorage.setItem('moist_wifi_setup','1');
  localStorage.setItem('moist_onboarded','1');
  function stored(){try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}}
  function q(tbl){
    var o={};
    ['select','eq','order','limit'].forEach(function(m){o[m]=function(){return o}});
    o.insert=o['delete']=function(){return Promise.resolve({data:null,error:null})};
    o.then=function(r,j){
      var d=tbl==='devices'?DEVICES:tbl==='readings'?READINGS:[];
      return Promise.resolve({data:d,error:null}).then(r,j);
    };
    return o;
  }
  window.supabase={
    createClient:function(){
      var cbs=[];
      setTimeout(function(){var s=stored();cbs.forEach(function(f){f('INITIAL_SESSION',s)})},80);
      return{
        auth:{
          onAuthStateChange:function(f){cbs.push(f);return{data:{subscription:{unsubscribe:function(){}}}}},
          signInWithPassword:function(){
            if(LOGIN_ERROR)return Promise.resolve({data:null,error:{message:LOGIN_ERROR}});
            if(SESSION)localStorage.setItem(KEY,JSON.stringify(SESSION));
            cbs.forEach(function(f){f('SIGNED_IN',SESSION)});
            return Promise.resolve({data:{user:SESSION&&SESSION.user},error:null});
          },
          signOut:function(){
            Object.keys(localStorage).forEach(function(k){if(k.startsWith('sb-'))localStorage.removeItem(k)});
            return Promise.resolve({error:null});
          },
          signInWithOAuth:function(){return Promise.resolve()},
          signUp:function(){return Promise.resolve({data:{},error:null})}
        },
        from:function(t){return q(t)}
      };
    }
  };
}();`;
}

// Intercept the Supabase CDN URL and return our mock library instead.
async function mockCDN(page, opts) {
  await page.route(/supabase-js/, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: makeMockLib(opts) })
  );
}

// Seed localStorage via addInitScript — re-runs on every navigation in this test.
// The mock library reads this key to determine the session on each page load.
async function seedSessionPersistent(page) {
  await page.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: MOCK_SESSION }
  );
}

// Seed localStorage one-shot via page.evaluate — does NOT re-run after navigation.
// Used for the sign-out test so the post-redirect reload has no session to find.
async function seedSessionOnce(page) {
  await page.evaluate(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: MOCK_SESSION }
  );
}

// ─── Unauthenticated ──────────────────────────────────────────────────────────

test.describe('Unauthenticated', () => {
  test('shows login screen when no session exists', async ({ page }) => {
    await mockCDN(page, { session: null });
    await page.goto('/');
    await expect(page.locator('#screen-login')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#screen-dashboard')).not.toBeVisible();
  });

  test('login screen has email, password fields and sign-in button', async ({ page }) => {
    await mockCDN(page, { session: null });
    await page.goto('/');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
  });

  test('shows error message on bad credentials', async ({ page }) => {
    await mockCDN(page, { session: null, loginError: 'Invalid login credentials' });
    await page.goto('/');
    await page.locator('#login-email').fill('wrong@example.com');
    await page.locator('#login-password').fill('badpass');
    await page.locator('#login-btn').click();
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 3000 });
  });
});

// ─── Authenticated ────────────────────────────────────────────────────────────

test.describe('Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    // Serve mock Supabase library with full data
    await mockCDN(page, { session: MOCK_SESSION, devices: MOCK_DEVICES, readings: MOCK_READINGS });
    // Seed the session key so the mock library finds it in localStorage on load
    await seedSessionPersistent(page);
  });

  test('shows dashboard and correct device name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#active-plant-name')).toHaveText('Living Room Fern', { timeout: 8000 });
  });

  test('device list renders the mock device', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#device-list')).toContainText('Living Room Fern', { timeout: 8000 });
    await expect(page.locator('#device-list')).toContainText('ESP32-ABCD');
  });

  test('gauge shows correct moisture reading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gauge-pct')).toHaveText('55%', { timeout: 8000 });
  });

  test('active device is saved to localStorage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#active-plant-name')).toHaveText('Living Room Fern', { timeout: 8000 });
    const saved = await page.evaluate(() => localStorage.getItem('moist_active_device'));
    expect(saved).toBe('ESP32-ABCD');
  });
});

// ─── Sign out ─────────────────────────────────────────────────────────────────

test.describe('Sign out', () => {
  test('clears session and redirects to login screen', async ({ page }) => {
    await mockCDN(page, { session: MOCK_SESSION, devices: MOCK_DEVICES, readings: MOCK_READINGS });
    await page.goto('/');

    // Seed once — does NOT re-run when sign-out triggers window.location.href='/'
    // so the reloaded page finds an empty localStorage and shows the login screen.
    await seedSessionOnce(page);
    await page.reload();
    await expect(page.locator('#screen-dashboard')).toBeVisible({ timeout: 8000 });

    await page.locator('[title="Sign out"]').click();

    // doSignOut clears sb-* keys, redirects to /. Mock reads localStorage →
    // finds nothing → INITIAL_SESSION(null) → login screen.
    await expect(page.locator('#screen-login')).toBeVisible({ timeout: 8000 });
    const session = await page.evaluate(() =>
      localStorage.getItem('sb-usoirglmgylpyokmusez-auth-token')
    );
    expect(session).toBeNull();
  });
});
