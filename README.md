# Strawberry Data Hub for DeepSeek Harness

将 Strawberry Data Hub 的草莓研究数据接入 DeepSeek Harness（DSH）。通过自然语言查询文献、解析基因、查看多组学上下文，并下载经过校验的 FASTA 序列。

首个公开测试版本：`0.1.0-beta.1`。

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

基因查询使用“基因 ID + 物种 + 组装版本”精确定位。序列导出直接使用服务端原始序列，校验序列长度、字符集、SHA-256及写入后的文件字节。新文件使用独立文件名。

## 安装

需要 Node.js 24 或更新版本，以及已配置模型的 DSH。当前验证环境为 Windows、Node 24、DSH CLI / dsh-tools `0.1.5-rc.2`。

npm 版本发布后，安装到独立配置：

```powershell
dsh plugin --profile strawberry add dsh-strawberry-data-hub@0.1.0-beta.1
dsh --profile strawberry --dump-config
dsh --profile strawberry
```

也可使用下载的发行包：

```powershell
dsh plugin --profile strawberry add ./dsh-strawberry-data-hub-0.1.0-beta.1.tgz
```

将 `strawberry` 换为已有配置名称，可安装到自己的 DSH 配置。Web 使用者请使用已启用 Web 的配置。模型账号由 DSH 管理。

## 使用示例

安装后，可以直接向 DSH 提问：

> 检索 FvSTOP1 调控草莓花青素的研究，列出研究材料和 DOI。

> 查询 FvesChr6G00057790.1，物种 Fragaria vesca，组装 v6.0(Horticulture Research. 2023) 的注释和表达信息。

> 导出上述基因的蛋白和 CDS 到一个 FASTA 文件，并提供下载链接。

> 查看草莓数据库有哪些基因组资源，区分草莓和病原体。

> 对文献中的定量结果做结构化证据检查，列出数值、单位、材料、具体对照和来源。

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

`researchOnly` 为可选设置，默认关闭。开启后，该配置仅允许七项 SDH 工具及 `ask_user_question`，适合草莓研究专用环境。

`timeoutMs` 范围为100–120000毫秒。服务地址由本地配置决定。遇到限流时，请稍后重新请求。

## 数据与结果说明

- 文献结果保留来源、研究条件和检索范围；记录数表示本次返回的数据。
- 证据检查核对来源标识、原文摘录及数值字面一致性。检索快照仅供同一会话使用，保留最近8次检索，30分钟有效。
- 蛋白字符数包含 `*`；氨基酸残基数不包含 `*`。CDS长度按核苷酸字符计数。
- 序列 SHA-256 对应原始序列字符；文件 SHA-256 对应完整 FASTA 字节。
- 数据和文献按各自来源的许可使用；本软件包分发插件代码，不包含数据库或文献语料。

## 开发

```powershell
npm ci --ignore-scripts
npm test
npm run smoke:live
npm pack
```

`npm test` 运行离线测试；`smoke:live` 顺序查询真实服务，需要网络，不调用生成模型。

已覆盖工具注册、输入校验、精确组装匹配、序列及文件校验、取消与超时、证据快照隔离等测试。版本更新见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证与反馈

插件代码采用 [MIT License](LICENSE)。数据及文献遵循各自来源的许可。

使用问题与建议请提交至 [GitHub Issues](https://github.com/798645706/dsh-strawberry-data-hub/issues)。
