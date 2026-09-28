> 非官方项目，由社区成员独立开发和维护。 / Unofficial community project, independently developed and maintained; not an official DeepSeek product.

## Project / 项目

**Strawberry Data Hub for DSH** brings strawberry literature, gene information and sequence downloads into DeepSeek Harness. Version **0.1.0-beta.1**, MIT licensed.

这是一个面向草莓研究的 DSH 工具插件：用自然语言查询文献、定位基因、查看多组学上下文，并导出经过校验的 FASTA 文件。

- Source / 源码：https://github.com/798645706/dsh-strawberry-data-hub
- npm：https://www.npmjs.com/package/dsh-strawberry-data-hub
- Release：https://github.com/798645706/dsh-strawberry-data-hub/releases/tag/v0.1.0-beta.1
- Data service / 数据服务：https://sci.hainanu.edu.cn/strawberry/

## DSH integration / 集成方式

The package declares a `dsh.bundle` configuration layer and registers seven native tools through the DSH tool runtime. The model selects tools; the plugin calls the existing Strawberry Data Hub HTTPS API and returns structured results. Data stays on the server. Model access is configured in DSH.

插件通过 `dsh.bundle` 配置层加载，将已有后端接口注册为 DSH 原生工具。模型负责选择工具，插件负责访问数据库、校验结果和交付文件，不需要把整个数据库下载到本地。

| Tool | Capability / 功能 |
|---|---|
| `sdh_literature_search` | Literature evidence with DOI and source identifiers / 文献证据与出处 |
| `sdh_gene_resolve` | Gene resolution by species and assembly / 基因、物种和组装定位 |
| `sdh_gene_context` | Annotation and available multi-omics context / 注释及多组学上下文 |
| `sdh_sequence_fetch` | Protein/CDS retrieval and integrity checks / 序列获取与校验 |
| `sdh_sequence_export` | Verified FASTA files and local Web downloads / FASTA附件与本机下载 |
| `sdh_data_catalog` | Research data inventories / 数据资源目录 |
| `sdh_evidence_check` | Source ID, DOI, exact excerpt and literal-number matching / 结构化来源与字面内容核对 |

Gene queries use an exact gene/species/assembly key. FASTA export checks sequence length, alphabet and SHA-256, then verifies the written file. Ambiguous identifiers can be resolved through a user selection. The optional `researchOnly` configuration restricts tool execution to SDH tools and user questions.

基因查询保留精确组装版本；有多个候选时先选择版本。FASTA直接来自服务端原始序列，校验长度、字符集、序列摘要和写入后的文件字节。导出会在当前DSH工作区创建新文件；查询会向配置的数据服务发送问题或基因参数。

## Install / 安装

Tested on Windows, Node.js 24 and DSH CLI / dsh-tools **0.1.5-rc.2**. Configure your model in DSH first. / 已验证环境：Windows、Node.js 24、DSH CLI / dsh-tools 0.1.5-rc.2；先完成DSH模型配置。

For a **new** profile / 首次创建独立Web配置：

```powershell
dsh --profile strawberry --from-default-profile web --dump-config
dsh plugin --profile strawberry add dsh-strawberry-data-hub@0.1.0-beta.1
dsh --profile strawberry
```

For an **existing Web profile**, skip initialization and replace `strawberry` with its name. Restart the profile after installation. / 已有Web配置时跳过第一条命令，替换配置名，安装后重启。

If you already created a base-only profile, see the [README setup instructions](https://github.com/798645706/dsh-strawberry-data-hub#安装) to enable the Web bundle.

## Try it / 使用示例

> 请使用 SDH 工具查看草莓数据库有哪些基因组资源，区分草莓与病原体。

> 请查询 FvesChr6G00057790.1，物种 Fragaria vesca，版本 v6.0(Horticulture Research. 2023) 的注释和表达信息。

> 请将上述基因的蛋白和 CDS 导出到一个 FASTA 文件，提供下载链接。

> Search for evidence on FvSTOP1 and strawberry anthocyanin accumulation. Include the study material and DOI.

## Screenshot / 实测截图

Resource inventory followed by a gene-context query in DSH Web. / DSH Web中的资源目录和基因上下文查询示例。

![Strawberry Data Hub resource and gene queries in DSH](https://raw.githubusercontent.com/798645706/dsh-strawberry-data-hub/main/docs/images/sdh-research-demo.png)

## Validation and feedback / 验证与反馈

The release passed 21 automated tests. Development checks also covered real API calls, Web tool use, assembly disambiguation, and downloaded FASTA byte checks. The npm package was installed into an independent DSH profile after publication.

首发完成21项自动化测试，并进行了真实接口、Web工具调用、版本消歧和FASTA下载校验。欢迎草莓研究、生物信息学和DSH插件开发者试用。

Please report reproducible issues with your DSH version and plugin version at [GitHub Issues](https://github.com/798645706/dsh-strawberry-data-hub/issues). / 问题反馈请附上DSH版本、插件版本和复现步骤。
