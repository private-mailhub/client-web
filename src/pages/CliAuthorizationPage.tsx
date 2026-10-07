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
  getCliDeviceAuthorization,
  CliDeviceAuthorizationError,
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
): authorization is CliDeviceAuthorization {
  if (authorization === null) {
    return false;
  }
  return state === 'pending';
}

function getApprovalButtonLabel(isSubmitting: boolean): string {
  if (isSubmitting) {
    return 'Submitting…';
  }
  return 'Approve device';
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

function hasExpired(expiresAt: string): boolean {
  const expiresAtTime = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtTime)) {
    return false;
  }
  return expiresAtTime <= Date.now();
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
  isSubmitting,
  feedback,
  onDecision,
}: {
  authorization: CliDeviceAuthorization;
  isSubmitting: boolean;
  feedback: string;
  onDecision: (approve: boolean) => void;
}) {
  return (
    <div className="space-y-6">
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
          disabled={isSubmitting}
          onClick={() => onDecision(false)}
        >
          Deny request
        </Button>
        <Button type="button" disabled={isSubmitting} onClick={() => onDecision(true)}>
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
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAuthorization = useCallback(
    async (code: string) => {
      setPageState('loading');
      setFeedback('');
      setAuthorization(null);

      try {
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
        if (hasExpired(result.expiresAt)) {
          clearCliAuthorizationState();
          setPageState('expired');
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

    const code = getCliAuthorizationCode();
    if (code === null) {
      setPageState('error');
      setFeedback('Your authorization session has expired. Enter the code again to continue.');
      return;
    }

    setIsSubmitting(true);
    setFeedback('');
    try {
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

      setPageState('pending');
      setFeedback('We could not submit your decision. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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

              {shouldShowAuthorizationDetails(pageState, authorization) && (
                <AuthorizationDetails
                  authorization={authorization}
                  isSubmitting={isSubmitting}
                  feedback={feedback}
                  onDecision={(approve) => void handleDecision(approve)}
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
