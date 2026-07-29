import { load } from "cheerio";

export type DeploymentAsset = {
  kind: "script" | "stylesheet";
  url: string;
};

export type DeploymentHealthReport = {
  pageUrl: string;
  assets: DeploymentAsset[];
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type VerifyDeploymentOptions = {
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export function extractDeploymentAssets(
  html: string,
  pageUrl: string,
): DeploymentAsset[] {
  const $ = load(html);
  const assets: DeploymentAsset[] = [];
  const seenUrls = new Set<string>();

  const addAsset = (
    kind: DeploymentAsset["kind"],
    value: string | undefined,
  ) => {
    if (!value) {
      return;
    }

    const url = new URL(value, pageUrl).toString();

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      assets.push({ kind, url });
    }
  };

  $("script[src]").each((_, element) => {
    addAsset("script", $(element).attr("src"));
  });
  $("link[rel~='stylesheet'][href]").each((_, element) => {
    addAsset("stylesheet", $(element).attr("href"));
  });

  return assets;
}

export async function verifyDeployment(
  pageUrl: string,
  options: VerifyDeploymentOptions = {},
): Promise<DeploymentHealthReport> {
  const normalizedPageUrl = normalizePageUrl(pageUrl);
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  validatePositiveInteger("attempts", attempts);
  validateNonNegativeInteger("delayMs", delayMs);
  validatePositiveInteger("timeoutMs", timeoutMs);

  const pageResponse = await fetchWithRetry(
    normalizedPageUrl,
    "首页",
    {
      attempts,
      delayMs,
      timeoutMs,
      fetchImpl,
    },
  );
  const contentType = pageResponse.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(
      `首页 Content-Type 不是 HTML：${contentType || "未提供"}`,
    );
  }

  const resolvedPageUrl = pageResponse.url || normalizedPageUrl;
  const html = await pageResponse.text();
  const assets = extractDeploymentAssets(html, resolvedPageUrl);

  if (!assets.some((asset) => asset.kind === "script")) {
    throw new Error("首页没有引用构建生成的脚本资源");
  }
  if (!assets.some((asset) => asset.kind === "stylesheet")) {
    throw new Error("首页没有引用构建生成的样式资源");
  }

  // 资源并行检查，缩短发布流水线耗时；单个资源仍保留独立重试。
  await Promise.all(
    assets.map(async (asset) => {
      const response = await fetchWithRetry(
        asset.url,
        asset.kind === "script" ? "脚本资源" : "样式资源",
        {
          attempts,
          delayMs,
          timeoutMs,
          fetchImpl,
        },
      );
      const body = await response.arrayBuffer();

      if (body.byteLength === 0) {
        throw new Error(`静态资源内容为空：${asset.url}`);
      }
    }),
  );

  return {
    pageUrl: resolvedPageUrl,
    assets,
  };
}

type FetchWithRetryOptions = Required<VerifyDeploymentOptions>;

async function fetchWithRetry(
  url: string,
  label: string,
  options: FetchWithRetryOptions,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await options.fetchImpl(url, {
        headers: {
          "cache-control": "no-cache",
          "user-agent": "joysound-helper-deployment-check/1.0",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < options.attempts) {
        await wait(options.delayMs);
      }
    }
  }

  throw new Error(
    `${label}无法访问（已尝试 ${options.attempts} 次）：${url}；` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function normalizePageUrl(value: string): string {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("部署地址必须使用 HTTP 或 HTTPS");
  }

  return url.toString();
}

function validatePositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function validateNonNegativeInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
}

async function wait(delayMs: number) {
  if (delayMs === 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
