export interface AuthResponse<User = unknown> {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }
}

interface RequestOptions extends RequestInit {
  skipRefresh?: boolean;
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (configured || 'http://localhost:3000/api/v1').replace(/\/$/, '');
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorPayload(payload: unknown, status: number): ApiErrorPayload {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const nested = (payload as { error?: unknown }).error;
    if (typeof nested === 'object' && nested !== null && 'message' in nested) {
      const candidate = nested as Partial<ApiErrorPayload>;
      return {
        code: candidate.code || `HTTP_${status}`,
        message: candidate.message || 'La solicitud no pudo completarse.',
        details: candidate.details,
        requestId: candidate.requestId,
      };
    }
  }
  return {
    code: `HTTP_${status}`,
    message: typeof payload === 'string' ? payload : 'La solicitud no pudo completarse.',
  };
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponse> | null = null;

  constructor(private readonly baseUrl = apiBaseUrl()) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setAccessToken(accessToken: string | null): void {
    this.accessToken = accessToken;
  }

  async login<User = unknown>(email: string, password: string): Promise<AuthResponse<User>> {
    const result = await this.execute<AuthResponse<User>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipRefresh: true,
    }, false);
    this.accessToken = result.accessToken;
    return result;
  }

  async refresh<User = unknown>(): Promise<AuthResponse<User>> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.execute<AuthResponse>('/auth/refresh', {
        method: 'POST',
        body: '{}',
        skipRefresh: true,
      }, false).finally(() => {
        this.refreshPromise = null;
      });
    }
    const result = await this.refreshPromise as AuthResponse<User>;
    this.accessToken = result.accessToken;
    return result;
  }

  async logout(): Promise<void> {
    try {
      await this.execute('/auth/logout', {
        method: 'POST',
        body: '{}',
        skipRefresh: true,
      }, true);
    } finally {
      this.accessToken = null;
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { skipRefresh = false } = options;
    try {
      return await this.execute<T>(path, options, true);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || skipRefresh || path === '/auth/refresh') {
        throw error;
      }

      try {
        await this.refresh();
        return await this.execute<T>(path, { ...options, skipRefresh: true }, true);
      } catch {
        this.accessToken = null;
        throw error;
      }
    }
  }

  private async execute<T>(path: string, options: RequestOptions, includeAccessToken: boolean): Promise<T> {
    const { skipRefresh: _skipRefresh, ...requestInit } = options;
    const headers = new Headers(requestInit.headers);
    if (requestInit.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (includeAccessToken && this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers,
      credentials: 'include',
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new ApiError(response.status, errorPayload(payload, response.status));
    return payload as T;
  }
}

export const apiClient = new ApiClient();
