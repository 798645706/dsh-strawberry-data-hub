# Strawberry Data Hub for DeepSeek Harness

将 Strawberry Data Hub 的草莓研究数据接入 DeepSeek Harness（DSH）。通过自然语言查询文献、解析基因、查看多组学上下文，并下载经过校验的 FASTA 序列。

当前版本：**Beta 2**。公开版本按 Beta 1、Beta 2 展示；Beta 2 的 npm 安装包版本为 `0.1.0-beta.8`。安装时请使用下面的完整命令，旧的 `0.1.0-beta.2` 包不包含本版全部功能。

代谢物按原始名称分组计数，并明确参考目录的计数范围，避免将重复目录条目相加。以上数量仅针对本次返回的数据，不代表完整数据库或独立化合物数量。

## 功能

| 工具 | 功能 |
|---|---|
| `sdh_literature_search` | 检索草莓研究文献，保留 DOI、证据标识与研究材料 |
| `sdh_gene_resolve` | 按基因 ID 解析物种及组装版本，多候选时支持追问 |
| `sdh_gene_context` | 查询功能注释及可用的表达、表观组等上下文 |
| `sdh_sequence_fetch` | 查询蛋白／CDS 元数据并校验序列 |
| `sdh_sequence_export` | 生成 FASTA 文件，提供附件及本机 Web 下载链接 |
| `sdh_data_catalog` | 浏览基因组及其他数据资源目录 |
| `sdh_evidence_check` | 核对结构化声明的证据 ID、DOI、原文摘录及数字字面匹配 |
| `sdh_database_status` / `sdh_module_catalog` | 查询实时服务状态与模块目录 |
| `sdh_batch_gene_annotation` | 批量功能注释，保留未解析和未注释的行 |
| `sdh_pangenome_query` / `sdh_graph_variation_query` | 查询泛基因组及图变异证据 |
| `sdh_single_cell_query` / `sdh_transcriptome_query` / `sdh_epigenome_query` | 查询单细胞、转录组和表观组数据 |
| `sdh_sequence_analysis` | 序列工具箱、ORF、批量序列及引物设计；保留具体引擎与设置 |
| `sdh_jbrowse_open` | 返回基因组浏览链接或待选择的参考版本 |
| `sdh_family_search` / `sdh_tf_search` / `sdh_mirna_search` | 查询基因家族、转录因子和 miRNA |
| `sdh_synteny_search` | 选择参考版本后查询共线性 |
| `sdh_functional_enrichment` | 有明确物种及组装背景的 GO / KEGG 富集 |
| `sdh_gwas_trait` / `sdh_gwas_study` | 查询特定性状或研究的 GWAS 证据 |
| `sdh_metabolite_search` / `sdh_coexpression_query` | 查询代谢组特征及共表达结果 |
| `sdh_download_search` | 查询来源文件的实际下载链接 |
| `sdh_crispr_query` / `sdh_primer_specificity_status` | 查询 CRISPR 数据、已有任务状态及引物特异性服务可用性 |
| `sdh_genome_evidence_query` | 查询参考组装、定位、区间、序列及变异证据 |
| `sdh_genome_prediction_prepare` | 查询预测参考目录、验证一个显式 SNV 草稿 |
| `sdh_berryplot_prepare` | 准备 BerryPlot 绘图方案，返回待确认草稿 |
| `sdh_berrylocus_prepare` | 准备带完整参考和 SNV 参数的 BerryLocus 预测草稿 |
| `sdh_task_confirm` / `sdh_task_status` | 经 DSH 单独确认后提交任务，并查询同一任务状态 |
| `sdh_prediction_result` | 获取已完成的 BerryLocus 预测结果 |
| `sdh_plot_download` | 校验并下载 BerryPlot 图件及数据 |

共 37 项工具：29 项只读接口、2 项本地工具和6项任务流程工具。接口白名单根据 2026-10-09 线上契约固定，不会自动启用服务端后来增加的工具。目录显示的服务器能力可能多于插件可执行的能力。

BLAST 和 CRISPR 新任务提交请在网站使用。本版本支持 BerryPlot 和 BerryLocus 的准备、确认及结果获取；取消、改图、重启后恢复任务仍需后续接入。预测草稿验证不代表已提交或完成预测；引物特异性状态查询不代表已完成特异性分析。

基因定位同时返回程序计算的半开区间长度，避免将基因组跨度与 CDS 长度混淆。`plot-data.json` 不超过24 KB时返回校验后的完整内容预览，较大文件仅提供下载。

基因查询使用“基因 ID + 物种 + 组装版本”精确定位。序列导出直接使用服务端原始序列，校验序列长度、字符集、SHA-256及写入后的文件字节。新文件使用独立文件名。

## 安装

需要 Node.js 24 或更新版本，以及已配置模型的 DSH。当前验证环境为 Windows、Node 24、DSH CLI / dsh-tools `0.1.5-rc.2`。

首次安装时，先从 Web 模板创建独立配置，再安装插件：

```powershell
dsh --profile strawberry --from-default-profile web --dump-config
dsh plugin --profile strawberry add dsh-strawberry-data-hub@0.1.0-beta.8
dsh --profile strawberry --dump-config
dsh --profile strawberry
```

也可使用下载的发行包：

```powershell
dsh plugin --profile strawberry add ./dsh-strawberry-data-hub-0.1.0-beta.8.tgz
```

第一条初始化命令仅用于尚未存在的配置。将 `strawberry` 换为已有 Web 配置名称时，跳过初始化。模型账号由 DSH 管理。

已有插件配置升级时，安装新的发行包并重启 DSH；无需重建 profile。仅更新 GitHub 源码不会更新已安装的 npm 包。

如果先安装插件创建了配置，启动后没有界面，请在该 profile 的 `package.json` 中，将 `dsh.profile.bundles` 设置为以下顺序，保存后重新启动：

```json
["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-strawberry-data-hub"]
```

## 使用示例

安装后，可以直接向 DSH 提问：

> 检索 FvSTOP1 调控草莓花青素的研究，列出研究材料和 DOI。

> 查询 FvesChr6G00057790.1，物种 Fragaria vesca，组装 v6.0(Horticulture Research. 2023) 的注释和表达信息。

> 导出上述基因的蛋白和 CDS 到一个 FASTA 文件，并提供下载链接。

> 查看草莓数据库有哪些基因组资源，区分草莓和病原体。

> 对文献中的定量结果做结构化证据检查，列出数值、单位、材料、具体对照和来源。

> miRNA 和共线性分析目前有哪些参考版本？先列出选项。

> 在代谢组中查询 sucrose，区分来源名称为 Sucrose 的特征和相关衍生物。

> 打开红颜基因组看看；如果存在多个组装版本，先让我选择。

> 给 FvesChr6G00057790.1 和 FvesChr2G00181140.1 做注释表，物种 Fragaria vesca，组装 v6.0(Horticulture Research. 2023)。

### BerryPlot 和 BerryLocus

> 请画 Camarosa 数据集的 FxaC_10g00030、FxaC_10g00031、FxaC_10g00070 表达热图。先展示方案，确认后提交。

> 查询 BerryLocus 中 Camarosa 可用的预测参考和方法，先不要提交预测。

绘图或预测按以下步骤执行：

1. 明确数据集和基因，或选择预测参考、方法及完整 SNV 参数。预测使用明确的 1-based 位置和 REF/ALT，不补猜缺失参数。
2. BerryPlot 先查询绘图目录，再发送结构化参数准备草稿，不调用网站模型、不消耗网站试用额度。BerryLocus 同样通过参考目录和结构化 SNV 参数准备草稿，不使用网站聊天模型或试用额度。两者均不在准备阶段开始计算。
3. 查看草稿中的数据来源和参数，在 DSH 中单独批准 `sdh_task_confirm` 后开始任务。
4. 查询返回的同一任务 ID；成功后获取预测结果，或下载 PNG、PDF、SVG、TIFF、绘图数据及相关说明文件。具体文件以该任务实际提供的产物为准。

任务会话和确认凭据只存于当前 DSH 进程内存，各对话隔离，不交给模型，也不转发 DSH 的模型密钥。下载链接仅供运行 DSH 的本机使用，15分钟有效；重启或切换对话后不能继续访问原任务。没有可用授权通道时不会提交。

请求结果不明确时，保留原草稿和任务 ID，不自动新建任务。遇到限流或权限拒绝则停止，不自动重试；明确拒绝后可由用户决定再次尝试。服务器任务权限、请求限流和计算资源限制仍适用。预测结果保留模型、参考版本及 `scientificValidation` 标记；模型分数不等同于实验验证的功能效应。

全部37项已接入工具均不调用网站聊天模型接口，不消耗网站聊天试用额度。DSH 自身使用用户配置的模型账号，其服务计费独立；BerryLocus 的 DNA 模型推理仍在服务器运行。此变更不代表无限计算额度或启用尚未开放的服务。

## 配置

默认服务地址为 [Strawberry Data Hub](https://sci.hainanu.edu.cn/strawberry/)。默认请求超时45秒，无需向插件传入网站模型密钥。

在对应 profile 的 `cordis.patch.yml` 中可配置：

```yaml
- id: strawberry-data-hub
  config:
    baseUrl: https://sci.hainanu.edu.cn/strawberry/
    timeoutMs: 45000
    researchOnly: true
```

`researchOnly` 为可选设置，默认关闭。开启后，该配置仅允许上述 37 项 SDH 工具及 `ask_user_question`，适合草莓研究专用环境。

`timeoutMs` 范围为100–120000毫秒，用于只读接口。任务流程请求固定90秒超时；这不代表服务端任务停止。服务地址由本地配置决定。任务流程遇到限流或连接中断不会自动重试。

## 数据与结果说明

- 文献结果保留来源、研究条件和检索范围；记录数表示本次返回的数据。
- 文献的人工整理证据、全文、发现摘要和扩展全文分别保留；摘要不能当作已阅读的全文。
- 各模块的组装与发布标识可能不同，请从对应目录选择。基因组区间使用 0-based half-open；SNV 草稿位置和 CRISPR 区间使用 1-based。不能直接混用坐标或发布版本。
- 证据检查核对来源标识、原文摘录及数值字面一致性。检索快照仅供同一会话使用，保留最近8次检索，30分钟有效。
- 蛋白字符数包含 `*`；氨基酸残基数不包含 `*`。CDS长度按核苷酸字符计数。
- 序列 SHA-256 对应原始序列字符；文件 SHA-256 对应完整 FASTA 字节。
- 数据和文献按各自来源的许可使用；本软件包分发插件代码，不包含数据库或文献语料。

## 开发

```powershell
npm ci --ignore-scripts
npm test
npm run smoke:live
node scripts/regression-beta2-live.js
npm pack
```

`npm test` 运行离线测试；`smoke:live` 顺序查询真实服务，需要网络，不调用生成模型。

`regression-beta2-live.js` 检查线上契约，并对每个已接入服务端工具运行真实请求；请求间隔 6 秒，遇到限流停止。可在命令后传入案例 ID 只复测指定案例；结果保存到独立的 `artifacts/beta2-live-*` 目录。它不提交计算任务，也不调用生成模型。

已覆盖工具注册、输入校验、精确组装匹配、序列及文件校验、取消与超时、证据快照隔离等测试。版本更新见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证与反馈

插件代码采用 [MIT License](LICENSE)。数据及文献遵循各自来源的许可。

使用问题与建议请提交至 [GitHub Issues](https://github.com/798645706/dsh-strawberry-data-hub/issues)。

大目录和代谢物丰度矩阵在20 MiB以内可通过完整JSON下载交付，超过模型上下文上限时不截断数据。链接15分钟有效；模型未读取的文件内容不会作为已知结果。其他接口保留原有大小限制。
