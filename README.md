# JOYSOUND X1 日语点歌助手

一个没有后端的静态 React 应用。用户输入完整歌名后，应用直接在浏览器中查询随网页打包的歌曲数据，并展示支持 JOYSOUND X1 的点歌编号。

## 技术栈

- Vite 8
- React 19
- TypeScript
- Bun
- Vitest

项目不再使用 Next.js、SQLite、Drizzle、API Route 或 npm。

## 本地运行

需要 Bun。当前项目使用的版本记录在 `package.json` 的 `packageManager` 字段中。

```bash
bun install
bun run dev
```

打开终端中显示的本地地址，默认通常是 [http://localhost:5173](http://localhost:5173)。

## 构建和检查

```bash
bun run lint
bun run test
bun run build
bun run preview
```

生产构建输出在 `dist/`，可以直接部署到任意静态网站托管服务。

## 数据维护

歌曲数据位于：

```text
src/data/songs.ts
```

每首歌曲包含：

- 日文官方歌名
- 歌手
- JOYSOUND 官方链接
- 一个或多个点歌版本
- X1 支持状态

应用目前包含 20 首歌曲和 60 个 X1 版本。修改歌曲数据后重新构建网页即可，不需要数据库迁移。

批量歌曲元数据采集工具位于 `scripts/crawl-joysound.ts`。开始使用前请阅读 [JOYSOUND 元数据采集指南](./CRAWLER.md)，并确认大规模采集和数据二次使用已经获得授权。

热门 Sitemap 当前的完整候选快照位于 `src/data/generated/joysound-popular-index.json`，共记录 2,355 个唯一歌曲页面及其更新时间。该索引只包含页面链接，不代表详情数据已经完成采集或接入。

每批采集后运行 `bun run audit:joysound`，可生成与手工数据合并后的本地 JSON、逐页状态、覆盖率和冲突报告。全部热门候选完成后使用 `bun run audit:joysound -- --require-complete` 执行严格验收。

## 中日汉字对照表

对照表位于：

```text
src/lib/kanji-variants.ts
```

搜索前会统一简体中文、繁体中文和日文新字体，例如：

```text
千本桜 = 千本樱 = 千本櫻
夜に駆ける = 夜に驱ける = 夜に驅ける
```

这个过程只处理同源汉字的字形差异，不进行翻译或模糊搜索。因此：

```text
千本樱     → 可以匹配「千本桜」
千本       → 不匹配
青之栖所   → 不匹配「青のすみか」
```

## 当前范围

- 只做完整歌名匹配
- 忽略空格、英文大小写和常见标点
- 只显示支持 JOYSOUND X1 的版本
- 不调用 AI
- 不连接线上数据库
- 不在运行时请求 JOYSOUND
