# 自动生成歌曲数据

此目录用于存放 `bun run crawl:joysound` 生成的最小化歌曲元数据。

生成文件不包含歌词、图片或网页源码。将大规模采集结果提交或接入前端前，必须确认已经取得数据抓取及二次使用授权，并完成抽样复核。

- `joysound-popular-index.json`：2,355 个热门候选页面和 `lastmod` 的固定输入快照。
- `joysound-songs.json`：采集器从成功页面生成的原始 X1 歌曲数据。
- `joysound-popular-catalog.json`：`bun run audit:joysound` 生成的合并曲库、逐页状态、覆盖率和冲突报告。
- `joysound-review-sample.json`：`bun run review:joysound` 生成的 20 首低速来源复核报告。
- `joysound-ranked-candidates.json`：`bun run discover:joysound` 从 151 个榜单入口生成的 839 个去重歌曲白名单。
- `joysound-ranked-songs.json`：从榜单白名单低速采集的详情结果，包含 812 首歌曲和 2,639 个 X1 版本。
- `joysound-ranked-catalog.json`：以接入前的热门曲库快照为基线生成的榜单严格审计与合并结果。
- `joysound-ranked-review-sample.json`：榜单详情数据的 20 首低速来源复核报告。
- `joysound-expanded-candidates.json`：95 位保留歌手的热门前 30 首与 1996～2011 平成榜生成的扩展候选；当前包含 2,435 个生产未收录页面。
- `joysound-expanded-songs.json`：扩展候选的详情结果，包含 2,435 首歌曲和 5,607 个 X1 版本。
- `joysound-expanded-catalog.json`：以榜单曲库快照为基线生成的扩展严格审计与最终生产曲库。
- `joysound-expanded-review-sample.json`：扩展详情数据的 20 首低速来源复核报告。
- `joysound-full-artist-candidates.json`：95 位保留歌手全部 1,108 个声明分页的完整候选索引，共 21,195 个唯一歌曲页，其中 18,287 个尚未进入生产曲库。
- `joysound-full-artist-songs.json`：从全曲目候选索引低速采集的详情结果；当前处理 7,964 页，成功 7,962、无 X1 2、错误 0，得到 9,994 个 X1 版本。
- `joysound-full-artist-catalog.json`：以稳定的 5,620 首扩展曲库为基线生成的渐进式审计结果。
- `joysound-full-artist-review-sample.json`：绑定当前生成歌曲 SHA-256 指纹的 20 首来源复核报告。
- `joysound-production-catalog.json`：通过生产晋级门禁后生成的精简前端曲库；不包含待处理 URL、错误明细等审计状态。

完整采集轮次仍必须通过严格审计和 20 首来源复核，不能只根据文件存在判断完成。固定分母的长周期任务可以通过 `bun run promote:joysound -- --allow-partial` 发布干净的阶段性检查点，但必须满足错误 0、冲突 0、至少 20 首来源复核一致，且复核输入指纹与当前生成歌曲完全相同。

当前全曲目详情处理 7,964/18,287 页，成功 7,962、无 X1 2、错误和冲突均为 0，来源复核 20/20 一致；阶段性生产曲库已晋级为 13,582 首歌曲、20,755 个版本。采集目前暂停，恢复起点为 `offset=7964`。
