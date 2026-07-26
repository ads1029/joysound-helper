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

最终数据必须通过严格审计和 20 首来源复核，不能只根据文件存在判断采集完成。扩展数据当前为 2,435/2,435 个新增候选已处理、2,435 首成功、0 错误、0 冲突，来源复核 20/20 一致；合并后的生产曲库为 5,620 首、10,761 个版本。
