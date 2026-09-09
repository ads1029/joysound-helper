# 仓库指南（Repository Guidelines）

## 协作语言

本项目以中文作为默认协作语言。Issue、Pull Request、提交说明、代码审查意见及项目文档应优先使用中文。代码标识符、文件名、命令和第三方技术名称保持英文；必要时可在中文说明后附英文原文，避免歧义。新增复杂逻辑时，应使用简短中文注释解释设计原因，而不是逐行复述代码。

## 项目结构与模块划分

本项目是使用 Vite 构建的 React 19 + TypeScript 静态应用，主要代码位于 `src/`：

- `src/main.tsx` 负责挂载应用，`src/App.tsx` 管理主要搜索流程。
- `src/components/` 存放可复用的界面组件。
- `src/lib/` 存放搜索与文本标准化逻辑，测试以 `*.test.ts` 就近放置。
- `src/data/songs.ts` 是前端曲库入口，`src/data/manual-songs.ts` 保存手工核心数据，`src/data/generated/` 保存采集、审计和复核 JSON。
- `src/types.ts` 定义共享类型，`src/styles.css` 存放全局样式。

生产构建输出到 `dist/`。Vite、Vitest、ESLint 和 TypeScript 配置均位于仓库根目录。

## 目标文档维护

`GOAL.md` 是长期目标、阶段里程碑、当前进度和关键决策的唯一记录。开始目标相关工作前应先阅读该文件；当功能范围、优先级、数据覆盖数量、里程碑状态、验收标准或阻塞因素发生变化时，必须在同一次改动中实时更新 `GOAL.md`。完成任务前应再次核对目标文档，避免代码与记录不一致。

## 构建、测试与本地开发

所有依赖和脚本必须使用 Bun，不要改用 npm 或 yarn。

```bash
bun install          # 根据 bun.lock 安装依赖
bun run dev          # 启动 Vite 开发服务器
bun run test         # 单次运行 Vitest 测试
bun run test:watch   # 监听文件变化并重复测试
bun run lint         # 检查 TypeScript 与 React 代码规范
bun run build        # 类型检查并生成生产构建
bun run preview      # 本地预览 dist/ 构建结果
bun run audit:joysound -- --require-complete # 严格审计曲库
bun run discover:joysound -- --confirm-authorized-discovery # 生成榜单白名单
```

提交 Pull Request 前，应运行 `bun run lint && bun run test && bun run build`。

## 编码风格与命名规范

沿用现有风格：两空格缩进、分号、双引号，以及多行结构中的尾随逗号。保持 TypeScript 严格模式，不保留未使用代码。React 组件和类型使用 `PascalCase`，函数与变量使用 `camelCase`，非组件文件使用 kebab-case，例如 `kanji-variants.ts`。工具函数优先使用具名导出。React Hooks 和热更新导出规则以 ESLint 为准。

## 测试规范

Vitest 默认使用 Node 环境。测试文件与被测模块同目录，纯逻辑测试采用 `name.test.ts`，React 界面测试采用 `name.test.tsx` 并在文件顶部声明 `@vitest-environment happy-dom`。测试描述应体现实际行为，覆盖成功匹配、标准化边界情况和无效输入；关键搜索、Tab 与分页交互使用 Testing Library 按可访问名称查询。目前没有强制覆盖率指标，但修改搜索、标准化、歌曲过滤或界面交互逻辑时必须补充回归测试。

## 数据与配置

保持应用无后端运行：歌曲数据直接编译进客户端，不应在运行时请求 JOYSOUND。`src/data/songs.ts` 只导出审计后的生产曲库，手工数据修改在 `src/data/manual-songs.ts` 完成。歌曲必须保留官方歌名、来源链接、唯一 ID 和准确的 X1 支持状态。禁止提交密钥、凭据或本地环境配置。

批量采集工具位于 `scripts/crawl-joysound.ts`，操作前必须阅读 `CRAWLER.md`。大规模采集及生成数据的二次使用必须先取得授权；禁止使用代理池、IP 轮换或其他方式绕过限流与封禁。完整采集轮次必须执行定义范围、采集、校验、复核、去重接入和文档更新闭环，并在 `GOAL.md` 的“采集轮次记录”中追加结果。固定分母的长周期任务可以拆成检查点子批次；每个子批次至少完成审计和进度记录，但在严格审计、来源复核与生产接入完成前不得把整个轮次标记为完成。

每个采集批次结束后必须运行 `bun run audit:joysound`，根据完整候选索引检查覆盖率、失败项和冲突；全量结果必须通过 `bun run audit:joysound -- --require-complete`，并用 `bun run review:joysound` 复核至少 20 首。不得把“已生成 JSON”或“命令未报错”单独视为完成依据。

采集暂停或意外中断时，先确认相关进程已停止，再以原子写入的检查点为权威状态。若歌曲输出文件落后于检查点，应只重放已完成范围以刷新输出，不得顺带扩大请求范围；随后重新审计并同步 `GOAL.md`、`TODO.md` 和生成数据说明。

目标网站存在反爬机制。详情采集保持单线程，默认使用 5 秒基础间隔和 0～2 秒随机抖动；不得低于 3 秒。每 100 个真实请求随机冷却 45～60 秒，大规模任务的最短批次冷却不得低于 45 秒。遇到 403 或重复 429 必须停止并保留检查点，不得通过更换 IP 继续请求。

`discover:joysound` 每 50 个入口页随机冷却 45～60 秒；它只能提取预先认可的综合、年龄、歌手、动漫和 Vocaloid 榜单链接，不得把演歌、洋乐或 K-POP 分类重新混入候选。

## 提交与 Pull Request

仓库已有可参考的 Git 历史，现有提交主要使用简短中文说明和 Conventional Commits 前缀，例如 `feat:`、`data:`、`docs:`、`fix:`、`test:`。新提交应按内容选择前缀、使用祈使语气，并保持主题单一。Pull Request 应说明用户可见的变化、列出已执行的验证命令、关联相关 Issue；涉及界面或样式时需附截图。
