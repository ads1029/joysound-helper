# 自动生成歌曲数据

此目录用于存放 `bun run crawl:joysound` 生成的最小化歌曲元数据。

生成文件不包含歌词、图片或网页源码。将大规模采集结果提交或接入前端前，必须确认已经取得数据抓取及二次使用授权，并完成抽样复核。

- `joysound-popular-index.json`：2,355 个热门候选页面和 `lastmod` 的固定输入快照。
- `joysound-songs.json`：采集器从成功页面生成的原始 X1 歌曲数据。
- `joysound-popular-catalog.json`：`bun run audit:joysound` 生成的合并曲库、逐页状态、覆盖率和冲突报告。

最终数据必须通过 `bun run audit:joysound -- --require-complete`，不能只根据文件存在判断采集完成。
