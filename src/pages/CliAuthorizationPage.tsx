import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  checkAuth,
  decideCliDeviceAuthorization,
  getUserInfo,
  getCliDeviceAuthorization,
  CliDeviceAuthorizationError,
  logout,
  type CliDeviceAuthorization,
} from '@/lib/api';
import {
  clearCliAuthorizationState,
  getCliAuthorizationCode,
  isValidCliAuthorizationCode,
  normalizeCliAuthorizationCode,
  saveCliAuthorizationCode,
} from '@/lib/cli-authorization-state';

type AuthorizationPageState =
  | 'entry'
  | 'loading'
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'error';

function getInitialPageState(): AuthorizationPageState {
  const storedCode = getCliAuthorizationCode();
  if (storedCode !== null) {
    return 'loading';
  }
  return 'entry';
}

function shouldShowCodeForm(state: AuthorizationPageState): boolean {
  if (state === 'entry') {
    return true;
  }
  return state === 'error';
}

function shouldShowAuthorizationDetails(
  state: AuthorizationPageState,
  authorization: CliDeviceAuthorization | null,
  username: string | null,
): { authorization: CliDeviceAuthorization; username: string } | null {
  if (authorization === null) {
    return null;
  }
  if (username === null) {
    return null;
  }
  if (state !== 'pending') {
    return null;
  }
  return { authorization, username };
}

function getApprovalButtonLabel(isSubmitting: boolean): string {
  if (isSubmitting) {
    return 'Submitting…';
  }
  return 'Approve device';
}

function getSwitchAccountButtonLabel(isSwitchingAccount: boolean): string {
  if (isSwitchingAccount) {
    return 'Switching account…';
  }
  return 'Switch account';
}

function isFinalPageState(state: AuthorizationPageState): boolean {
  if (state === 'approved') {
    return true;
  }
  if (state === 'denied') {
    return true;
  }
  return state === 'expired';
}

function isExpiredAuthorizationError(error: unknown): boolean {
  if (!(error instanceof CliDeviceAuthorizationError)) {
    return false;
  }
  if (error.code === 'expired_token') {
    return true;
  }
  return error.code === 'expired_code';
}

function isDeniedAuthorizationError(error: unknown): boolean {
  if (!(error instanceof CliDeviceAuthorizationError)) {
    return false;
  }
  return error.code === 'access_denied';
}

function isUnauthorizedAuthorizationError(error: unknown): boolean {
  if (!(error instanceof CliDeviceAuthorizationError)) {
    return false;
  }
  return error.code === 'unauthorized';
}

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(expiresAt));
}

function getScopeLabel(scope: string): string {
  if (scope === 'relay:read') {
    return 'View relay addresses';
  }
  if (scope === 'relay:write') {
    return 'Create and update relay addresses';
  }
  if (scope === 'keys:read') {
    return 'View API key details';
  }
  if (scope === 'keys:revoke') {
    return 'Revoke API keys';
  }
  return scope;
}

function getStateTitle(state: AuthorizationPageState): string {
  if (state === 'loading') {
    return 'Checking authorization request';
  }
  if (state === 'pending') {
    return 'Review this device';
  }
  if (state === 'approved') {
    return 'Device approved';
  }
  if (state === 'denied') {
    return 'Request denied';
  }
  if (state === 'expired') {
    return 'Authorization code expired';
  }
  return 'Authorize a device';
}

function AuthorizationDetails({
  authorization,
  username,
  isSubmitting,
  isSwitchingAccount,
  feedback,
  accountFeedback,
  accountChangedFeedback,
  onDecision,
  onSwitchAccount,
}: {
  authorization: CliDeviceAuthorization;
  username: string;
  isSubmitting: boolean;
  isSwitchingAccount: boolean;
  feedback: string;
  accountFeedback: string;
  accountChangedFeedback: string;
  onDecision: (approve: boolean) => void;
  onSwitchAccount: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Signed in as <span className="font-medium">{username}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSubmitting || isSwitchingAccount}
          onClick={onSwitchAccount}
        >
          {getSwitchAccountButtonLabel(isSwitchingAccount)}
        </Button>
      </div>

      {accountFeedback !== '' && (
        <Alert variant="destructive">
          <AlertTitle>Could not switch accounts</AlertTitle>
          <AlertDescription>{accountFeedback}</AlertDescription>
        </Alert>
      )}

      {accountChangedFeedback !== '' && (
        <Alert>
          <AlertTitle>Review the account before continuing</AlertTitle>
          <AlertDescription>{accountChangedFeedback}</AlertDescription>
        </Alert>
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border bg-background p-4">
          <dt className="text-sm text-muted-foreground">Application</dt>
          <dd className="mt-1 font-medium">{authorization.clientName}</dd>
        </div>
        <div className="rounded-md border bg-background p-4">
          <dt className="text-sm text-muted-foreground">Device</dt>
          <dd className="mt-1 font-medium">{authorization.deviceName}</dd>
        </div>
        <div className="rounded-md border bg-background p-4">
          <dt className="text-sm text-muted-foreground">CLI version</dt>
          <dd className="mt-1 font-medium">{authorization.cliVersion}</dd>
        </div>
        <div className="rounded-md border bg-background p-4">
          <dt className="text-sm text-muted-foreground">Code expires</dt>
          <dd className="mt-1 font-medium">
            <time dateTime={authorization.expiresAt}>{formatExpiry(authorization.expiresAt)}</time>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="cli-permissions-heading" className="space-y-3">
        <h2 id="cli-permissions-heading" className="font-semibold">
          This device will be able to
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {authorization.scopes.map((scope) => (
            <li key={scope}>{getScopeLabel(scope)}</li>
          ))}
        </ul>
      </section>

      {feedback !== '' && (
        <Alert variant="destructive">
          <AlertTitle>Could not submit your decision</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting || isSwitchingAccount}
          onClick={() => onDecision(false)}
        >
          Deny request
        </Button>
        <Button
          type="button"
          disabled={isSubmitting || isSwitchingAccount}
          onClick={() => onDecision(true)}
        >
          {getApprovalButtonLabel(isSubmitting)}
        </Button>
      </div>
    </div>
  );
}

const CliAuthorizationPage = () => {
  const navigate = useNavigate();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [pageState, setPageState] = useState<AuthorizationPageState>(getInitialPageState);
  const [userCode, setUserCode] = useState(() => getCliAuthorizationCode() ?? '');
  const [authorization, setAuthorization] = useState<CliDeviceAuthorization | null>(null);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [accountFeedback, setAccountFeedback] = useState('');
  const [accountChangedFeedback, setAccountChangedFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  const loadAuthorization = useCallback(
    async (code: string) => {
      setPageState('loading');
      setFeedback('');
      setAccountFeedback('');
      setAccountChangedFeedback('');
      setAuthorization(null);
      setAccountUsername(null);

      try {
        const userInfo = await getUserInfo();
        if (typeof userInfo.username !== 'string' || userInfo.username.trim() === '') {
          throw new Error('invalid_user_info');
        }
        setAccountUsername(userInfo.username.trim());

        const result = await getCliDeviceAuthorization(code);
        setAuthorization(result);

        if (result.status === 'approved') {
          clearCliAuthorizationState();
          setPageState('approved');
          return;
        }
        if (result.status === 'denied') {
          clearCliAuthorizationState();
          setPageState('denied');
          return;
        }
        setPageState('pending');
      } catch (error) {
        if (isExpiredAuthorizationError(error)) {
          clearCliAuthorizationState();
          setPageState('expired');
          return;
        }
        if (isDeniedAuthorizationError(error)) {
          clearCliAuthorizationState();
          setPageState('denied');
          return;
        }
        if (isUnauthorizedAuthorizationError(error)) {
          navigate('/login', { replace: true });
          return;
        }
        if (!checkAuth()) {
          navigate('/login', { replace: true });
          return;
        }

        if (error instanceof CliDeviceAuthorizationError && error.code === 'invalid_code') {
          clearCliAuthorizationState();
          setPageState('error');
          setFeedback('That code is not valid. Check the code shown in your CLI and try again.');
          return;
        }

        setPageState('error');
        setFeedback('We could not load this authorization request. Please try again.');
      }
    },
    [navigate],
  );

  useEffect(() => {
    const storedCode = getCliAuthorizationCode();
    if (storedCode === null) {
      return;
    }

    setUserCode(storedCode);
    if (!checkAuth()) {
      navigate('/login', { replace: true });
      return;
    }
    void loadAuthorization(storedCode);
  }, [loadAuthorization, navigate]);

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = normalizeCliAuthorizationCode(userCode);
    setUserCode(normalizedCode);

    if (!isValidCliAuthorizationCode(normalizedCode)) {
      setPageState('error');
      setFeedback('Enter the user code shown in your CLI.');
      return;
    }

    const savedCode = saveCliAuthorizationCode(normalizedCode);
    if (savedCode === null) {
      setPageState('error');
      setFeedback(
        'Your browser could not save this code for sign-in. Check your browser settings and try again.',
      );
      return;
    }

    if (!checkAuth()) {
      navigate('/login', { replace: true });
      return;
    }

    await loadAuthorization(savedCode);
  };

  const handleDecision = async (approve: boolean) => {
    if (pageState !== 'pending') {
      return;
    }
    if (isSwitchingAccount) {
      return;
    }

    const code = getCliAuthorizationCode();
    if (code === null) {
      setPageState('error');
      setFeedback('Your authorization session has expired. Enter the code again to continue.');
      return;
    }

    setIsSubmitting(true);
    setFeedback('');
    try {
      const userInfo = await getUserInfo();
      if (typeof userInfo.username !== 'string' || userInfo.username.trim() === '') {
        throw new Error('invalid_user_info');
      }
      const currentUsername = userInfo.username.trim();
      if (currentUsername !== accountUsername) {
        setAccountUsername(currentUsername);
        setAccountChangedFeedback(
          `The signed-in account changed to ${currentUsername}. Review this request for that account before choosing again.`,
        );
        return;
      }

      setAccountChangedFeedback('');
      const status = await decideCliDeviceAuthorization(code, approve);
      clearCliAuthorizationState();
      if (status === 'approved') {
        setPageState('approved');
      } else {
        setPageState('denied');
      }
    } catch (error) {
      if (isExpiredAuthorizationError(error)) {
        clearCliAuthorizationState();
        setPageState('expired');
        return;
      }
      if (isDeniedAuthorizationError(error)) {
        clearCliAuthorizationState();
        setPageState('denied');
        return;
      }
      if (isUnauthorizedAuthorizationError(error)) {
        navigate('/login', { replace: true });
        return;
      }
      if (!checkAuth()) {
        navigate('/login', { replace: true });
        return;
      }

      setPageState('pending');
      setFeedback('We could not submit your decision. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    const storedCode = getCliAuthorizationCode();
    const codeToPreserve = storedCode ?? normalizeCliAuthorizationCode(userCode);
    const savedCode = saveCliAuthorizationCode(codeToPreserve);
    if (savedCode === null) {
      setAccountFeedback(
        'Your CLI authorization code could not be saved. Keep this page open and try again.',
      );
      return;
    }

    setIsSwitchingAccount(true);
    await logout();
    navigate('/login', { replace: true });
  };

  const handleStartOver = () => {
    clearCliAuthorizationState();
    setUserCode('');
    setAuthorization(null);
    setFeedback('');
    setPageState('entry');
    window.requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  const isLoggedIn = checkAuth();
  const authorizationDetails = shouldShowAuthorizationDetails(
    pageState,
    authorization,
    accountUsername,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Header isLoggedIn={isLoggedIn} />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-6">
          <header className="space-y-3 text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
              Mailhub CLI
            </p>
            <h1 className="text-3xl font-bold">Authorize a device</h1>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Enter the user code shown in your CLI to review and authorize its access to your
              Mailhub account.
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>{getStateTitle(pageState)}</CardTitle>
              <CardDescription aria-live="polite">
                {pageState === 'pending' && 'Review the requested access before you continue.'}
                {pageState === 'loading' && 'Loading the device request…'}
                {pageState === 'approved' && 'The CLI can now finish signing in.'}
                {pageState === 'denied' && 'The CLI device was not authorized.'}
                {pageState === 'expired' && 'Start a new login from your CLI to get a fresh code.'}
                {pageState === 'entry' &&
                  'The code is only used to find the request and is never placed in the page URL.'}
                {pageState === 'error' && 'Check the code and try again.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {shouldShowCodeForm(pageState) && (
                <form className="space-y-4" onSubmit={handleCodeSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="cli-user-code">User code</Label>
                    <Input
                      ref={codeInputRef}
                      id="cli-user-code"
                      name="userCode"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={32}
                      value={userCode}
                      onChange={(event) => setUserCode(event.target.value)}
                      placeholder="ABCD-EFGH"
                      aria-describedby="cli-code-help"
                    />
                    <p id="cli-code-help" className="text-sm text-muted-foreground">
                      Find this code in the terminal where you started Mailhub CLI login.
                    </p>
                  </div>
                  {feedback !== '' && (
                    <Alert variant="destructive">
                      <AlertTitle>Authorization could not continue</AlertTitle>
                      <AlertDescription>{feedback}</AlertDescription>
                    </Alert>
                  )}
                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              )}

              {pageState === 'loading' && (
                <div className="flex items-center justify-center gap-3 py-6" role="status">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-muted-foreground">Checking the user code…</span>
                </div>
              )}

              {authorizationDetails !== null && (
                <AuthorizationDetails
                  authorization={authorizationDetails.authorization}
                  username={authorizationDetails.username}
                  isSubmitting={isSubmitting}
                  isSwitchingAccount={isSwitchingAccount}
                  feedback={feedback}
                  accountFeedback={accountFeedback}
                  accountChangedFeedback={accountChangedFeedback}
                  onDecision={(approve) => void handleDecision(approve)}
                  onSwitchAccount={() => void handleSwitchAccount()}
                />
              )}

              {pageState === 'approved' && (
                <Alert>
                  <AlertTitle>Authorization complete</AlertTitle>
                  <AlertDescription>
                    Return to your terminal. Your CLI will complete sign-in automatically.
                  </AlertDescription>
                </Alert>
              )}

              {pageState === 'denied' && (
                <Alert variant="destructive">
                  <AlertTitle>Authorization denied</AlertTitle>
                  <AlertDescription>
                    This CLI request was denied. You can close this page or start a new login.
                  </AlertDescription>
                </Alert>
              )}

              {pageState === 'expired' && (
                <Alert variant="destructive">
                  <AlertTitle>Code expired</AlertTitle>
                  <AlertDescription>
                    This code can no longer be used. Start a new login in your CLI and enter the
                    fresh code here.
                  </AlertDescription>
                </Alert>
              )}

              {isFinalPageState(pageState) && (
                <Button type="button" variant="outline" onClick={handleStartOver}>
                  Enter another code
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default CliAuthorizationPage;
