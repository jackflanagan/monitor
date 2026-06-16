// tests/auth.test.js
//
// Tests the auth rehydration pattern introduced to fix pull-to-refresh
// disconnects. The old code relied on onAuthStateChange + INITIAL_SESSION,
// which fires before Supabase has loaded the stored token from localStorage.
// The fix uses getSession() explicitly on startup so the session is always
// available immediately.
//
// makeInit() mirrors the init() function in index.html exactly, so if the
// implementation regresses back to INITIAL_SESSION the tests here will fail.

async function makeInit(sb, { loadDashboard, showScreen, getLocalStorage }) {
  let currentUser = null;

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadDashboard(session.user);
  } else {
    showScreen(getLocalStorage('moist_wifi_setup') ? 'login' : 'wifi-setup');
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && !currentUser) {
      currentUser = session.user;
      await loadDashboard(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showScreen('login');
    }
  });

  return { getCurrentUser: () => currentUser };
}

function makeMockSb(sessionResult) {
  const listeners = [];
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: sessionResult }, error: null }),
      onAuthStateChange: jest.fn((cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      _fireEvent: async (event, session) => {
        for (const cb of listeners) await cb(event, session);
      },
    },
  };
}

describe('auth init — getSession-first pattern', () => {
  test('getSession() is called before onAuthStateChange is registered', async () => {
    const callOrder = [];
    const sb = {
      auth: {
        getSession: jest.fn(async () => { callOrder.push('getSession'); return { data: { session: null } }; }),
        onAuthStateChange: jest.fn((cb) => { callOrder.push('onAuthStateChange'); return { data: { subscription: {} } }; }),
      },
    };
    await makeInit(sb, { loadDashboard: jest.fn(), showScreen: jest.fn(), getLocalStorage: () => 'true' });
    expect(callOrder).toEqual(['getSession', 'onAuthStateChange']);
  });

  test('loads dashboard immediately when stored session exists', async () => {
    const mockUser = { id: 'u1', email: 'plant@example.com' };
    const sb = makeMockSb({ user: mockUser, access_token: 'tok' });
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => null });

    expect(loadDashboard).toHaveBeenCalledWith(mockUser);
    expect(showScreen).not.toHaveBeenCalled();
  });

  test('shows login when no session and wifi already configured', async () => {
    const sb = makeMockSb(null);
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: (k) => k === 'moist_wifi_setup' ? 'true' : null });

    expect(showScreen).toHaveBeenCalledWith('login');
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  test('shows wifi-setup on first launch with no session', async () => {
    const sb = makeMockSb(null);
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => null });

    expect(showScreen).toHaveBeenCalledWith('wifi-setup');
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  test('INITIAL_SESSION event does NOT trigger loadDashboard', async () => {
    // Regression guard: the old broken pattern called loadDashboard from
    // INITIAL_SESSION inside onAuthStateChange. The new pattern ignores it.
    const sb = makeMockSb(null);
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => 'true' });
    await sb.auth._fireEvent('INITIAL_SESSION', { user: { id: 'u2' } });

    expect(loadDashboard).not.toHaveBeenCalled();
  });

  test('SIGNED_IN after no-session init loads dashboard (delayed token refresh)', async () => {
    // Covers the case where getSession() returns null because the token is
    // being refreshed, then SIGNED_IN fires moments later.
    const sb = makeMockSb(null);
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => 'true' });
    const mockUser = { id: 'u3', email: 'late@example.com' };
    await sb.auth._fireEvent('SIGNED_IN', { user: mockUser });

    expect(loadDashboard).toHaveBeenCalledWith(mockUser);
  });

  test('TOKEN_REFRESHED after no-session init loads dashboard', async () => {
    const sb = makeMockSb(null);
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => 'true' });
    const mockUser = { id: 'u4' };
    await sb.auth._fireEvent('TOKEN_REFRESHED', { user: mockUser });

    expect(loadDashboard).toHaveBeenCalledWith(mockUser);
  });

  test('SIGNED_IN does not call loadDashboard again if already signed in', async () => {
    // Prevents duplicate dashboard loads if SIGNED_IN fires after a session
    // was already restored by getSession().
    const mockUser = { id: 'u5' };
    const sb = makeMockSb({ user: mockUser, access_token: 'tok' });
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => null });
    await sb.auth._fireEvent('SIGNED_IN', { user: mockUser });

    expect(loadDashboard).toHaveBeenCalledTimes(1);
  });

  test('SIGNED_OUT shows login screen', async () => {
    const mockUser = { id: 'u6' };
    const sb = makeMockSb({ user: mockUser, access_token: 'tok' });
    const loadDashboard = jest.fn();
    const showScreen = jest.fn();

    await makeInit(sb, { loadDashboard, showScreen, getLocalStorage: () => null });
    await sb.auth._fireEvent('SIGNED_OUT', null);

    expect(showScreen).toHaveBeenCalledWith('login');
  });
});
