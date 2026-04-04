# CLAUDE CODE TASK: Google Sign-In Implementation

## Context
Read `CPS_PRD_FOR_CURSOR.md` first.
Supabase project: `orhbzvoqtingmqjbjzqw`
Live URL: `https://hagerstone-cps.vercel.app`

---

## WHAT'S ALREADY DONE
- Google OAuth app created in Google Cloud Console (External, hagerstone.com org)
- OAuth Client ID created with correct redirect URIs
- `VITE_GOOGLE_CLIENT_ID` added to `.env` and Vercel
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`
- Google provider enabled in Supabase Dashboard → Authentication → Providers
- Login page (`src/pages/Login.tsx`) already has a Google Sign-In button (UI only, not wired)

## WHAT NEEDS TO BE BUILT
Wire up the Google Sign-In button to actually authenticate via Supabase OAuth.

---

## IMPLEMENTATION

### 1. Update `src/pages/Login.tsx`

Find the existing Google Sign-In button. It likely looks like:
```tsx
<Button variant="outline" className="w-full">
  <img src="/google.svg" ... />
  Sign in with Google
</Button>
```

Replace with a working handler:

```tsx
const handleGoogleSignIn = async () => {
  setIsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) throw error;
    // No need to handle success — Supabase redirects automatically
  } catch (error: any) {
    toast.error(error.message || 'Google sign-in failed');
    setIsLoading(false);
  }
};
```

Wire it to the button:
```tsx
<Button 
  variant="outline" 
  className="w-full" 
  onClick={handleGoogleSignIn}
  disabled={isLoading}
>
  {isLoading ? (
    <Loader2 className="h-4 w-4 animate-spin mr-2" />
  ) : (
    <img src="/google-icon.svg" className="h-4 w-4 mr-2" alt="Google" />
  )}
  Sign in with Google
</Button>
```

---

### 2. Handle the OAuth callback

When Google redirects back to the app, Supabase handles the token exchange automatically. But we need to make sure the auth state is picked up correctly.

In `src/contexts/AuthContext.tsx`, verify `onAuthStateChange` is set up — it should already be there. If not, add:

```typescript
useEffect(() => {
  // Get initial session
  supabase.auth.getSession().then(({ data: { session } }) => {
    setSession(session);
    setUser(session?.user ?? null);
    if (session?.user) {
      fetchUserProfile(session.user.id);
    }
    setLoading(false);
  });

  // Listen for auth changes (handles OAuth callback)
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (event === 'SIGNED_IN' && session?.user) {
        await fetchUserProfile(session.user.id);
        // Redirect to dashboard if on login page
        if (window.location.pathname === '/login') {
          navigate('/dashboard');
        }
      }
      
      if (event === 'SIGNED_OUT') {
        setUserProfile(null);
        navigate('/login');
      }
    }
  );

  return () => subscription.unsubscribe();
}, []);
```

---

### 3. Handle new Google users — auto-create cps_users profile

When a user signs in with Google for the first time, their `auth.users` record is created but `cps_users` may not exist yet (the trigger handles email/password signup but may not fire for OAuth).

In `fetchUserProfile`, handle the case where no profile exists:

```typescript
const fetchUserProfile = async (authUid: string) => {
  const { data: profile, error } = await supabase
    .from('cps_users')
    .select('*')
    .eq('auth_uid', authUid)
    .maybeSingle();

  if (profile) {
    setUserProfile(profile);
    return;
  }

  // No profile yet — create one with default requestor role
  // Get user details from auth
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    const { data: newProfile } = await supabase
      .from('cps_users')
      .insert({
        auth_uid: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        role: 'requestor', // default role for new Google sign-ins
        active: true,
      })
      .select()
      .single();
    
    if (newProfile) {
      setUserProfile(newProfile);
    }
  }
};
```

---

### 4. Add Google icon asset

If `/public/google-icon.svg` doesn't exist, create it:

```bash
# Download Google icon or create simple SVG
cat > public/google-icon.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
EOF
```

---

### 5. Update `src/App.tsx` — handle OAuth redirect route

Supabase OAuth redirects back to the `redirectTo` URL with a hash fragment. Make sure the app handles this. The Supabase client does this automatically, but add a catch-all in the router if needed:

```tsx
// In App.tsx, the dashboard route should be accessible after OAuth
// Make sure /dashboard is NOT behind a loading gate that fires before auth state resolves
```

The key is that `setLoading(false)` only fires AFTER `getSession()` completes — so the ProtectedRoute doesn't redirect to login before the OAuth session is picked up.

---

### 6. Vercel environment variable check

Make sure `VITE_GOOGLE_CLIENT_ID` is in Vercel:
- Vercel Dashboard → hagerstone-cps → Settings → Environment Variables
- Add: `VITE_GOOGLE_CLIENT_ID` = your client ID

After adding → **Redeploy** (Deployments → Redeploy latest).

---

## TESTING

1. Open `https://hagerstone-cps.vercel.app/login`
2. Click "Sign in with Google"
3. Should redirect to Google OAuth consent screen
4. After approving → should land on `/dashboard`
5. Check Supabase Dashboard → Authentication → Users — new user should appear
6. Check `cps_users` table — profile should be auto-created with `role = 'requestor'`

**Test on localhost too:**
```bash
npm run dev
# Open http://localhost:5173/login
# Click Sign in with Google
```

---

## IMPORTANT NOTES

1. **Google OAuth testing mode**: If the Google app is in "Testing" mode, only users added as test users in Google Cloud Console → Audience → Test users can sign in. Add personal Gmail addresses there before testing.

2. **`VITE_GOOGLE_API_KEY` is NOT needed** for Google Sign-In — leave it blank. It's only for Google Drive/Picker API (future feature).

3. **The Supabase trigger** `handle_new_user_signup` may or may not fire for OAuth users depending on how it's written. The `fetchUserProfile` fallback in step 3 above handles this safely regardless.

4. **Role assignment**: New Google sign-ins get `requestor` role by default. To promote someone to `procurement_head`, update manually in Supabase Dashboard → Table Editor → `cps_users` → find the user → edit role.

---

## FILES TO MODIFY
- `src/pages/Login.tsx` — wire Google button to `signInWithOAuth`
- `src/contexts/AuthContext.tsx` — add OAuth callback handling + auto-create profile
- `public/google-icon.svg` — create if missing
