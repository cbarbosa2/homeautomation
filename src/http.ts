export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  data: T;
  headers: Headers;
}

export class HttpClient {
  private baseTimeout: number;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.baseTimeout = parseInt(Deno.env.get("HTTP_TIMEOUT") || "30000");
    this.defaultHeaders = {
      "User-Agent": "HomeAutomation/1.0.0",
      "Content-Type": "application/json",
    };
  }

  async get<T = unknown>(
    url: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>("GET", url, options);
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>("POST", url, { ...options, body: data });
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>("PUT", url, { ...options, body: data });
  }

  async delete<T = unknown>(
    url: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>("DELETE", url, options);
  }

  async request<T = unknown>(
    method: string,
    url: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const {
      headers = {},
      body,
      timeout = this.baseTimeout,
      retries = 3,
      retryDelay = 1000,
    } = options;

    const requestHeaders = new Headers({
      ...this.defaultHeaders,
      ...headers,
    });

    let requestBody: string | undefined;
    if (body) {
      if (typeof body === "string") {
        requestBody = body;
      } else {
        requestBody = JSON.stringify(body);
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        console.log(`🌐 ${method} ${url} (attempt ${attempt + 1}/${retries + 1})`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: requestBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        let data: T;
        const contentType = response.headers.get("content-type");
        
        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text() as T;
        }

        const result: HttpResponse<T> = {
          status: response.status,
          statusText: response.statusText,
          data,
          headers: response.headers,
        };

        if (response.ok) {
          console.log(`✅ ${method} ${url} - ${response.status}`);
          return result;
        } else {
          console.error(`❌ ${method} ${url} - ${response.status}: ${response.statusText}`);
          if (attempt === retries || !this.shouldRetry(response.status)) {
            return result;
          }
        }

      } catch (error) {
        lastError = error as Error;
        console.error(`❌ ${method} ${url} - Error:`, error);

        if (attempt === retries) {
          throw new Error(`HTTP request failed after ${retries + 1} attempts: ${lastError.message}`);
        }

        if (attempt < retries) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError || new Error("Unknown HTTP error");
  }

  private shouldRetry(status: number): boolean {
    return status >= 500 || status === 429 || status === 408;
  }

  async healthCheck(url: string): Promise<boolean> {
    try {
      const response = await this.get(url, { timeout: 5000, retries: 0 });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  setDefaultHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  removeDefaultHeader(key: string): void {
    delete this.defaultHeaders[key];
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}