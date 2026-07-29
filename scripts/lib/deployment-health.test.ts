import { describe, expect, it } from "vitest";

import {
  extractDeploymentAssets,
  verifyDeployment,
} from "./deployment-health";

describe("deployment-health", () => {
  it("解析并去重首页引用的相对脚本与样式地址", () => {
    const html = `
      <script type="module" src="./assets/app.js"></script>
      <script src="./assets/app.js"></script>
      <link rel="stylesheet" href="/joysound-helper/assets/app.css">
      <link rel="preload" href="./assets/font.woff2">
    `;

    expect(
      extractDeploymentAssets(
        html,
        "https://example.com/joysound-helper/",
      ),
    ).toEqual([
      {
        kind: "script",
        url: "https://example.com/joysound-helper/assets/app.js",
      },
      {
        kind: "stylesheet",
        url: "https://example.com/joysound-helper/assets/app.css",
      },
    ]);
  });

  it("确认首页及其脚本和样式都能访问且内容非空", async () => {
    const requestedUrls: string[] = [];
    const responses = new Map<string, Response>([
      [
        "https://example.com/app/",
        new Response(
          `
            <script src="./assets/app.js"></script>
            <link rel="stylesheet" href="./assets/app.css">
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      ],
      [
        "https://example.com/app/assets/app.js",
        new Response("console.log('ready');"),
      ],
      [
        "https://example.com/app/assets/app.css",
        new Response("body { color: black; }"),
      ],
    ]);

    const report = await verifyDeployment(
      "https://example.com/app/",
      {
        attempts: 1,
        delayMs: 0,
        fetchImpl: async (input) => {
          const url = String(input);
          const response = responses.get(url);

          requestedUrls.push(url);

          if (!response) {
            return new Response("not found", { status: 404 });
          }

          return response;
        },
      },
    );

    expect(report.assets).toHaveLength(2);
    expect(requestedUrls).toEqual([
      "https://example.com/app/",
      "https://example.com/app/assets/app.js",
      "https://example.com/app/assets/app.css",
    ]);
  });

  it("部署传播期间首页暂时失败时会重试", async () => {
    let pageAttempts = 0;

    await verifyDeployment("https://example.com/", {
      attempts: 2,
      delayMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);

        if (url === "https://example.com/") {
          pageAttempts += 1;

          if (pageAttempts === 1) {
            return new Response("deploying", { status: 503 });
          }

          return new Response(
            `
              <script src="/app.js"></script>
              <link rel="stylesheet" href="/app.css">
            `,
            {
              headers: { "content-type": "text/html" },
            },
          );
        }

        return new Response("asset");
      },
    });

    expect(pageAttempts).toBe(2);
  });

  it("首页缺少构建样式时拒绝通过", async () => {
    await expect(
      verifyDeployment("https://example.com/", {
        attempts: 1,
        delayMs: 0,
        fetchImpl: async () =>
          new Response('<script src="/app.js"></script>', {
            headers: { "content-type": "text/html" },
          }),
      }),
    ).rejects.toThrow("样式资源");
  });
});
