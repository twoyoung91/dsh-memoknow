# MemoKnow：DeepSeek Harness 的记忆与知识插件

[English](README.md) | [简体中文](README.zh-CN.md)

MemoKnow 是一款面向个人记忆和用户导入知识的本地 DeepSeek Harness（DSH）插件。它在 SQLite 中保存结构化记录，以 SHA-256 为原始文档生成快照，结合 FTS5 全文检索和可选的 sqlite-vec 语义检索，提供 Agent 工具，并在 DSH 内置界面中管理数据。

MemoKnow 是独立的社区插件，并非 DeepSeek Harness 官方组件。它面向单人使用的本地 DSH 配置，不是多用户服务，也不提供云端同步。

## 功能概览

- 从符合条件的已完成聊天轮次中提炼可长期使用的事实、偏好和决定；明确提出“请记住”的请求会更快处理。
- 在 DSH 的 **Settings → MemoKnow** 中查看、编辑或永久遗忘单条记忆。
- 将文本/Markdown、Word、PDF、CSV 和 Excel 文档导入为不可变的本地知识快照，并检索其中的文字；忽略文档内嵌图片。
- 默认使用 Local FTS，不需要嵌入模型或 API 密钥；可选的本地 CPU 嵌入或 OpenAI 兼容嵌入可改善知识检索。

## 界面一览

以下截图来自 MemoKnow 的真实管理界面，但使用的是虚构示例记录，不包含私人聊天内容或导入文档。

写入、搜索、编辑或遗忘单条记忆：

![包含三条示例记忆和写入表单的 MemoKnow 记忆库](docs/screenshots/memory-library.png)

导入文档或粘贴 Markdown，再查看可搜索的知识库：

![包含导入表单和两份示例文档快照的 MemoKnow 知识库](docs/screenshots/knowledge-import.png)

从默认的 Local FTS 开始，按需调整检索设置：

![使用默认 Local FTS 模式的 MemoKnow 检索设置](docs/screenshots/retrieval-settings.png)

安装步骤、日常使用、备份和故障排查请参阅[英文用户手册](docs/USER_MANUAL.md)。贡献者请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 从源码目录快速安装

需要 Node.js `^22.19.0 || >=24.0.0`、pnpm 11.7，以及兼容的 DSH 安装。在 MemoKnow 源码目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm run check
dsh plugin --profile web add .
```

如果 DSH 也是源码克隆，且 `dsh` 不在 `PATH` 中，请在 DSH 仓库根目录改用 `pnpm dsh plugin --profile web add <MemoKnow 的绝对路径>`。如果安装的是预构建的 GitHub Release 压缩包，使用 `dsh plugin --profile web add <压缩包路径>`。安装后重启 web 配置。暂不支持直接用 `github:` 安装：这种方式会获取源码，而插件目前不会在 Git 安装过程中自动构建。上述命令参照 DSH 的[插件打包指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)和 [CLI 参考文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)。

安装并重启 DSH 后，打开 **Settings → MemoKnow**，选择 **Setup & settings**。Local FTS 是默认模式，无需模型。首次启用 Local CPU embedding 时，会下载固定版本的 INT8 `Xenova/multilingual-e5-small` 模型（含分词器文件约 140 MiB）。OpenAI-compatible 模式会在启用前验证接口地址和模型。如果嵌入服务之后不可用，仍可使用 FTS 检索。

如果选择 API 模式，请将密钥放入指定的环境变量（默认为 `MEMOKNOW_EMBEDDING_API_KEY`）。MemoKnow 只保存环境变量名，不保存密钥值。

## 托管嵌入策略

集成 MemoKnow 的产品可以通过标准 Cordis 插件配置固定一个 OpenAI 兼容嵌入服务，无需修改公开的插件源码：

```yaml
- id: dsh-memoknow
  name: '@dsh-external/dsh-memoknow'
  config:
    embedding:
      source: managed-api
      baseUrl: https://managed.example/v1
      model: managed-embedding-model
      apiKeyEnv: MEMOKNOW_EMBEDDING_API_KEY
```

托管模式会将这些值映射到运行时设置，并在管理界面中禁用相应控件；通过设置 API 更新也不能覆盖该策略。接口地址必须使用 HTTPS，但本机回环地址可用于开发。配置中只能写环境变量名；密钥值必须由进程环境提供，MemoKnow 不会返回密钥。

## 本地数据

默认数据目录为 `$DSH_HOME/memoknow`；如果未设置 `DSH_HOME`，则使用 `~/.dsh/memoknow`：

```text
memoknow.sqlite3
objects/sha256/aa/bb/<完整 SHA-256>[.txt]
models/                         # 仅启用 Local CPU 后创建
```

可以在 Cordis patch 中设置插件的 `dataDir`，选择其他目录。SQLite 是元数据和生命周期状态的权威数据源；原始文档快照是不可变文件；FTS 和 sqlite-vec 索引都属于可派生的数据。

## 导入知识

管理界面支持粘贴文本/Markdown，或导入不超过 25 MiB 的文件：

- Word `.doc`、`.docx`
- 带可提取文本层的 PDF
- UTF-8 编码的 CSV
- Excel `.xlsx`

插件会保留原始文件的完整字节。内嵌图片不会被提取、嵌入或索引。因此，只有扫描图片、没有文字层的 PDF 需要先经过 OCR；本版本不提供 OCR。暂不支持旧版 Excel `.xls`。

## Agent 工具

- `memoknow_remember`
- `memoknow_search`
- `memoknow_memory_list`
- `memoknow_memory_update`
- `memoknow_memory_forget`
- `memoknow_knowledge_import`
- `memoknow_knowledge_remove`

记忆会随时间降低检索排名，但不会因年龄自动删除。遗忘操作会删除记忆记录及其搜索索引，不创建墓碑记录。将过时记忆自动移入墓碑区仍是设计目标，并非本版本功能。遗忘由聊天提炼出的记忆不会删除原始 DSH 聊天会话或其他备份。移除知识会删除文档记录和索引；只有当内容寻址的原始文件不再被任何记录引用时，才会删除该文件。

记忆半衰期默认为 180 天，自动召回最多返回 12 条记忆。知识检索没有用户可配置的结果上限，但仍有内部安全上限，以保护 Agent 上下文和 SQLite 进程。

## 自动更新记忆

每次根 Agent 完成一个轮次后，MemoKnow 只记录新增的用户直接发言和可见的助手文本。它会排除失败的轮次、子 Agent、工具或插件上下文、推理内容、简单应答，以及疑似凭证的内容。这一步在本地完成，不调用模型，并推进每个会话的持久化检查点。

符合条件的轮次使用该 DSH 会话已配置的模型提炼。普通更新按两分钟或五个符合条件的轮次批量处理；“请记住”之类的明确请求会跳过等待。模型只看到待处理的新增内容及少量通过词汇检索找到的相关记忆，不能使用工具；输出上限为 700 token，调用超时为 45 秒，并且必须返回经验证的 JSON。推断得出的记忆以 `candidate` 状态进入；用户明确要求记住的内容可以以 `active` 状态进入。

捕获和处理分别使用独立事务。重启、超时、模型故障、版本冲突或 token 预算不足时，已捕获的轮次会保留待处理，以便稍后重试。成功处理时，记忆变更、用量统计和检查点推进会原子提交。自动提炼默认每个会话最多使用 8,000 token，每个 UTC 日最多使用 30,000 token。

## 安全提示

管理 API 与 DSH 页面同源，拒绝跨站修改请求，将 JSON 请求体限制为 1 MiB、文件请求限制为 26 MiB，验证文件签名，使用参数化 SQL，设置严格的浏览器响应头，且不会返回敏感设置。除非另行部署带身份验证的反向代理，否则请让 DSH web 服务仅监听本机回环地址。

请通过 [SECURITY.md](SECURITY.md) 报告安全问题，不要公开提交 issue。

## 当前限制

- 自动提炼使用当前 DSH 会话的模型；MemoKnow 设置页尚无独立的模型或预算控制。
- 导入 PDF 时不会对扫描页面进行 OCR，并且会忽略图片。
- Local CPU embedding 通过 Transformers.js 在 CPU 上运行；网络较慢或知识库较大时，首次下载和建立索引可能耗时较长。
- 不导入 Excel `.xls`、受密码保护的文件、宏或内嵌图片。
- 管理界面目前使用简单的 prompt/confirm 对话框完成编辑与删除。
