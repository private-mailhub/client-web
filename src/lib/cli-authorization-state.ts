const CLI_AUTHORIZATION_CODE_KEY = 'cliAuthorizationCode';
const POST_LOGIN_TARGET_KEY = 'postLoginTarget';
export const CLI_AUTHORIZATION_PATH = '/cli/authorize';
const DASHBOARD_PATH = '/dashboard';

export function normalizeCliAuthorizationCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

export function isValidCliAuthorizationCode(code: string): boolean {
  return /^[A-Z0-9-]{4,32}$/.test(code);
}

export function saveCliAuthorizationCode(code: string): string | null {
  const normalizedCode = normalizeCliAuthorizationCode(code);
  if (!isValidCliAuthorizationCode(normalizedCode)) {
    return null;
  }

  try {
    sessionStorage.setItem(CLI_AUTHORIZATION_CODE_KEY, normalizedCode);
    sessionStorage.setItem(POST_LOGIN_TARGET_KEY, CLI_AUTHORIZATION_PATH);
    return normalizedCode;
  } catch {
    return null;
  }
}

export function getCliAuthorizationCode(): string | null {
  try {
    const storedCode = sessionStorage.getItem(CLI_AUTHORIZATION_CODE_KEY);
    if (storedCode === null) {
      return null;
    }

    const normalizedCode = normalizeCliAuthorizationCode(storedCode);
    if (isValidCliAuthorizationCode(normalizedCode)) {
      return normalizedCode;
    }

    clearCliAuthorizationState();
    return null;
  } catch {
    return null;
  }
}

export function clearCliAuthorizationState(): void {
  try {
    sessionStorage.removeItem(CLI_AUTHORIZATION_CODE_KEY);
    sessionStorage.removeItem(POST_LOGIN_TARGET_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function getPostLoginTarget(): string {
  try {
    const target = sessionStorage.getItem(POST_LOGIN_TARGET_KEY);
    if (target === CLI_AUTHORIZATION_PATH) {
      const code = getCliAuthorizationCode();
      if (code !== null) {
        return CLI_AUTHORIZATION_PATH;
      }
    }
  } catch {
    return DASHBOARD_PATH;
  }

  return DASHBOARD_PATH;
}
