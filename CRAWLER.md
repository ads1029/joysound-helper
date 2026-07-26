# JOYSOUND 元数据采集指南

## 使用边界

采集器只读取 JOYSOUND 官方 Sitemap 和公开歌曲页面，并只保留歌名、歌手、来源链接、X1 版本名及曲号。它不会保存歌词、图片、用户数据或完整网页源码。

JOYSOUND 的 `robots.txt` 当前未禁止 `/web/search/song/`，但网站政策限制未经许可的复制和二次利用。大规模采集、提交生成数据或将其接入公开应用前，必须先取得相应授权。禁止通过代理池、IP 轮换或其他方式绕过限流与封禁。

## 常用命令

```bash
# 查看参数
bun run crawl:joysound -- --help

# 只读取 Sitemap，不请求歌曲页面
bun run crawl:joysound -- --dry-run

# 将全部热门候选链接和 lastmod 写入本地 JSON
bun run crawl:joysound -- \
  --index-only \
  --limit=2355 \
  --output=src/data/generated/joysound-popular-index.json

# 默认采集前 20 页，间隔 5～7 秒并使用检查点
bun run crawl:joysound

# 取得授权后处理整个热门 Sitemap
bun run crawl:joysound -- \
  --limit=2355 \
  --delay-ms=5000 \
  --jitter-ms=2000 \
  --batch-size=100 \
  --batch-pause-min-ms=45000 \
  --batch-pause-max-ms=60000 \
  --confirm-authorized-large-run

# 取得授权后按 50 页一轮循环处理
bun run crawl:joysound -- \
  --offset=0 \
  --limit=50 \
  --confirm-authorized-large-run
bun run crawl:joysound -- \
  --offset=50 \
  --limit=50 \
  --confirm-authorized-large-run

# 每批采集后生成合并曲库与覆盖率报告
bun run audit:joysound

# 全部批次结束后执行严格验收
bun run audit:joysound -- --require-complete

# 以 5～7 秒串行间隔等距复核 20 首
bun run review:joysound

# 从官方榜单生成已预筛选的歌曲白名单
bun run discover:joysound -- --confirm-authorized-discovery

# 扩展热门歌手前 30 首与 1996～2011 年榜单
bun run discover:expanded -- --confirm-authorized-discovery

# 从榜单白名单采集全部 812 个尚未入库的详情页
bun run crawl:joysound -- \
  --input-index=src/data/generated/joysound-ranked-candidates.json \
  --new-only \
  --limit=812 \
  --delay-ms=5000 \
  --jitter-ms=2000 \
  --batch-size=100 \
  --batch-pause-min-ms=45000 \
  --batch-pause-max-ms=60000 \
  --output=src/data/generated/joysound-ranked-songs.json \
  --checkpoint=.cache/joysound-ranked-crawler/checkpoint.json \
  --confirm-authorized-large-run

# 全部榜单详情完成后，以接入前的热门曲库快照为基线严格审计
bun run audit:joysound -- \
  --index=src/data/generated/joysound-ranked-candidates.json \
  --new-only \
  --checkpoint=.cache/joysound-ranked-crawler/checkpoint.json \
  --baseline=popular \
  --output=src/data/generated/joysound-ranked-catalog.json \
  --require-complete

# 等距抽取 20 首榜单歌曲重新核对官方来源
bun run review:joysound -- \
  --input=src/data/generated/joysound-ranked-songs.json \
  --output=src/data/generated/joysound-ranked-review-sample.json

# 采集扩展索引中的 2,435 个新增详情页
bun run crawl:joysound -- \
  --input-index=src/data/generated/joysound-expanded-candidates.json \
  --new-only \
  --limit=2435 \
  --delay-ms=5000 \
  --jitter-ms=2000 \
  --batch-size=100 \
  --batch-pause-min-ms=45000 \
  --batch-pause-max-ms=60000 \
  --output=src/data/generated/joysound-expanded-songs.json \
  --checkpoint=.cache/joysound-expanded-crawler/checkpoint.json \
  --confirm-authorized-large-run

# 以榜单阶段曲库为稳定基线严格审计扩展结果
bun run audit:joysound -- \
  --index=src/data/generated/joysound-expanded-candidates.json \
  --new-only \
  --checkpoint=.cache/joysound-expanded-crawler/checkpoint.json \
  --baseline=ranked \
  --output=src/data/generated/joysound-expanded-catalog.json \
  --require-complete

# 等距抽取 20 首扩展歌曲重新核对官方来源
bun run review:joysound -- \
  --input=src/data/generated/joysound-expanded-songs.json \
  --output=src/data/generated/joysound-expanded-review-sample.json
```

默认歌曲结果写入 `src/data/generated/joysound-songs.json`，检查点写入 `.cache/joysound-crawler/checkpoint.json`。`--index-only` 只固化 Sitemap 中的候选链接和 `lastmod`，不请求歌曲详情页。重复执行详情采集会复用 `lastmod` 未变化的成功记录；使用 `--refresh` 可强制重新获取。

默认审计命令读取热门候选索引、检查点和 `src/data/manual-songs.ts`，将热门阶段合并曲库写入 `src/data/generated/joysound-popular-catalog.json`。榜单阶段使用上方的显式参数和独立输出。报告包含逐页状态、待处理链接、冲突明细和 `summary`；`--require-complete` 会在存在待处理页面、请求错误或数据冲突时返回失败，适合作为最终验收和 CI 门禁。

复核命令从成功生成的数据中等距抽取 20 首，重新读取官方页面并比对歌名、歌手、X1 版本名、类型和曲号。结果写入 `src/data/generated/joysound-review-sample.json`；该过程保持单线程和 5～7 秒间隔，不保存网页源码。

榜单发现命令读取综合、急升、新曲趋势、2012～2025 年度榜、2016～2025 年发行歌曲榜、2014～2025 年 10～40 岁榜，以及当前热门歌手的热门歌曲。动漫和 Vocaloid 的当前周榜、月榜及年度分类榜是强制入口；演歌、洋乐和 K-POP 段落不读取。首次快照共检查 151 个入口页，得到 839 个去重歌曲页面，其中 812 页尚未进入生产曲库。

详情采集器可通过 `--input-index` 直接读取本地榜单白名单；`--new-only` 会排除索引生成时已进入生产曲库的页面。榜单任务必须使用独立的 `--output` 和 `--checkpoint`，避免与热门 Sitemap 采集记录混合。2026-07-26 首次先试采 200 页，随后复用检查点完成剩余 612 页；完整结果为 812/812 成功。

审计器读取榜单索引时同样使用 `--new-only`，以确保分母与详情采集一致；`--baseline=popular` 固定使用接入前的热门曲库快照检查新增歌曲和曲号冲突，避免生产入口切换后重跑摘要发生变化。只有严格审计通过且榜单专用的 20 首来源复核全部一致后，才可让 `src/data/songs.ts` 改用 `joysound-ranked-catalog.json`。

扩展发现读取 95 位保留歌手的官方热门前 30 首及 1996～2011 平成榜，在详情采集前排除 7 位命中演歌榜的歌手。首次扩展得到 2,889 个去重页面，其中 454 个已在榜单曲库、2,435 个需要新增采集。详情阶段 2,435/2,435 成功，生成 5,607 个 X1 版本；严格审计错误 0、冲突 0，来源复核 20/20 一致。

扩展审计必须使用 `--baseline=ranked` 固定接入前的 3,185 首榜单曲库快照。审计通过后，`src/data/songs.ts` 改用 `joysound-expanded-catalog.json`；当前生产曲库为 5,620 首歌曲、10,761 个 X1 版本。详情页中以“ミュージックビデオ観放題”为标题前缀的特殊模板由 `<title>` 提取歌名和歌手，页面内的 X1 版本仍按标准卡片校验。

## 每轮标准操作

### 1. 开始前

- 阅读 `GOAL.md`，确定本轮来源、目标数量和验收标准。
- 确认大规模采集和数据二次使用授权有效。
- 运行 `bun run crawl:joysound -- --dry-run`，记录 Sitemap 候选数量。
- 保留上一轮生成数据，便于比较新增、变化和失效记录。

### 2. 执行采集

先使用 5 秒基础间隔和 0～2 秒随机抖动运行 20 页以内的小批量验证。解析结果正常后，再按授权范围使用 `--offset` 和 `--limit` 分轮处理。大规模任务默认每 100 个真实请求随机冷却 45～60 秒，最短冷却不得低于 45 秒。所有轮次应复用同一个输出和检查点路径；中断后使用相同参数重新执行即可恢复。除非解析规则发生变化，不要使用 `--refresh`。

每批结束后立即运行 `bun run audit:joysound`。确认本批使 `processedCandidates` 增长，且 `errorPages`、`conflictCount` 没有出现未解释的增加，再开始下一批。

### 3. 校验与复核

```bash
bun run lint
bun run test
bun run build
```

检查生成结果中的 `stats`，确认成功、无 X1、不可用和失败数量之和与本轮已处理数量一致。每轮至少人工复核 20 首，不足 20 首时全部复核，重点检查同名歌曲、多个歌手、版本类型和重复曲号。

完整热门快照的机器验收条件为：

- `indexedCandidates` 和 `processedCandidates` 均为 2,355。
- `pendingCandidates`、`errorPages`、`conflictCount` 均为 0。
- `crawlReady` 为 `true`，且 `bun run audit:joysound -- --require-complete` 成功退出。
- 合并后的歌曲 ID、版本 ID、曲号和来源链接通过 `bun run test` 校验。
- `bun run review:joysound` 结果为 20/20 一致。

### 4. 接入与收尾

- 生成数据先与 `src/data/manual-songs.ts` 去重，不直接覆盖手工数据。
- 逐项解决审计报告中的冲突并补充回归测试，再接入前端搜索。
- 更新 `README.md` 中的歌曲与版本数量。
- 更新 `GOAL.md` 的当前基线、待办状态和“采集轮次记录”。
- 记录未解决的失败项及下一轮重试范围。

## 采集策略

- 默认单线程，每次歌曲请求至少间隔 5 秒，并增加最多 2 秒随机抖动；命令拒绝低于 3 秒的配置。
- 每完成 100 个真实歌曲详情请求随机冷却 45～60 秒；断点中已完成、未发起网络请求的页面不计入批次。
- 榜单发现同样保持 5～7 秒单线程间隔，并在每 50 个轻量入口页后随机冷却 45～60 秒。
- `429` 和服务端错误会按 `Retry-After` 或指数退避重试。
- `429` 未提供 `Retry-After` 时，首次至少等待 60 秒，后续指数增加等待时间。
- 遇到 `403` 或重试后仍然 `429` 时立即停止，不切换 IP。
- 每处理一页就原子写入检查点，任务中断后可以恢复。
- 输出前检查歌曲 ID、版本 ID、数字曲号、来源链接和 X1 状态。

2026-07-25 固定的热门 Sitemap 快照共有 2,355 个候选页面，但其顺序不代表官方热度排名。首次全量采集成功 2,353 页，另有 2 个官方索引失效的 404 页面。计算后续热门歌曲覆盖率时，应另外使用 JOYSOUND 日榜、半年榜或年度榜建立目标清单。

## 接入流程

生成文件不会自动通过验收。取得授权后，应先抽样核对标题、歌手、曲号和版本归类，再解决与 `src/data/manual-songs.ts` 的重复项；审计通过后由 `src/data/songs.ts` 将合并 JSON 接入搜索功能，并更新 `GOAL.md` 中的覆盖数量。

一轮采集只有在自动校验通过、人工抽查完成、生产数据已验证、文档与覆盖统计同步之后才算结束。
