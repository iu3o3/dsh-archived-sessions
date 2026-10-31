# 发布指南（GitHub + npm + 插件商店）

这条链路是：**GitHub 仓库（源码）→ npm 包（安装源）→ awesome-dsh-plugin 目录（商店索引）**。
DSH 插件市场（dshmarket）本身不是商店后台：它读的是社区目录
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
目录里加一条，市场网页和 DSH 的 **Plugins → Discover** 就会自动收录（通常一天内）。

---

## 0. 先做两件事

1. ~~把占位符换掉~~ —— 已填成 `iu3o3`（`package.json` 的 repository/homepage/bugs/author、`LICENSE` 版权人）。
   换 GitHub 用户名时记得同步这几处。
2. **决定包名**：不和别人撞名就直接用 `dsh-archived-sessions`；怕撞就用 `@iu3o3/dsh-archived-sessions`
   （scoped 包发布时必须带 `--access public`，安装时也写全名）。
3. **补一张截图**：README 里放 `docs/screenshot.png`（设置页 + 菜单行），商店卡片会用到。
   图片放在 GitHub 仓库里，商店只从 GitHub 加载图片。

---

## 1. 本地验证包内容

```bash
cd plugins/dsh-archived-sessions
npm pack --dry-run
```

确认输出里有：`lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`package.json`、`README.md`、`LICENSE`。
**`lib/client.js` 必须在包里**——DSH 只加载构建好的客户端 bundle，没有构建步骤。

真机试装（先备份 profile 配置）：

```bash
# 1) 删掉 profile 里手动加的那段 insert（否则和 bundle 安装重复挂载，启动会失败）
#    ~/.dsh/profiles/desktop/cordis.patch.yml 末尾的 `- insert: ... dsh-archived-sessions`
dsh plugin --profile desktop add ./dsh-archived-sessions-0.1.0.tgz
```

装上后 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 会自动多一项，
重启 DSH，设置里出现「归档会话」即成功。

> `package.json` 里的 `dsh.bundle.patch` 就是给这条安装路径用的：CLI 把包加进 bundles，
> 启动时合并包内的 `cordis.patch.yml`（一段 `insert:`），不需要用户手改配置。

---

## 2. 推到你的 GitHub

```bash
cd plugins/dsh-archived-sessions
git init
git add -A
git commit -m "feat: archived-sessions plugin for DSH"
git branch -M main
git remote add origin https://github.com/iu3o3/dsh-archived-sessions.git
git push -u origin main
```

仓库设置里建议：

- **Topics**：`dsh`、`dsh-plugin`、`deepseek-harness`
- **About → Website**：填 npm 包地址
- 打 tag：`git tag v0.1.0 && git push --tags`（市场用 tag/版本判断更新）

---

## 3. 发布到 npm

```bash
npm login                     # 需要先有 npm 账号
npm publish --access public   # scoped 包必须加；非 scoped 加不加都行
```

发布前的三个硬性条件：

| 检查项 | 说明 |
| --- | --- |
| `"private": true` 已删除 | 否则 npm 直接拒绝发布 |
| `version` 每次递增 | 市场靠 npm 版本号判断「有更新」 |
| `files` 含 `lib/` 与 `cordis.patch.yml` | 否则装上去缺文件 |

验证：

```bash
npm view dsh-archived-sessions version
dsh plugin --profile desktop add dsh-archived-sessions@0.1.0
```

---

## 4. 上架插件商店（awesome-dsh-plugin）

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`。
2. 按它 README 的格式，在插件列表里**加一条**（一个 PR 只加一个插件），通常包含：
   插件名、一句话简介（中英）、GitHub 仓库链接、npm 包名、分类、作者。
3. 提 PR → 合并后：
   - `awesome-dsh-plugin.com` 与 `dshmarket.com` 的索引由 CI 刷新（约一天）；
   - DSH 里 **Plugins → Discover** 直接能搜到，`plugin_market` 工具也能搜到。

要点：

- 目录只收录**可以安装成功**的来源（npm 包或 GitHub 仓库），所以第 3 步先做完；
- 市场安装会优先用 npm 包（秒级），GitHub 源码安装是兜底；
- 卡片的兼容性提示来自 `engines.dsh` 或 `@deepseek-ai/dsh-*` 的 peer 依赖，没写就显示「未知」，不影响上架。

---

## 5. 后续发版

```bash
npm version patch          # 0.1.0 -> 0.1.1，自动打 tag
git push && git push --tags
npm publish --access public
```

市场会比对 npm 版本给出「有更新」提示；GitHub Release 里写更新说明，卡片的
**What changed** 会链接过去。

---

## 6. 常见坑

- **重复挂载**：用户手动在 `cordis.patch.yml` 加过 `insert` 行，再用市场安装 → 同一个 id 插入两次，
  插件树启动失败。安装前删掉手动那段（README 里已写明）。
- **`private: true` 忘了删**：npm 拒绝发布，日志一眼能看出来。
- **只在本地能跑**：最常见原因是 `lib/client.js` 没进 `files`，或者 `dsh.client` 丢了。
- **改完不生效**：客户端 bundle 有版本快照，重装插件或重启 DSH；本地开发可以只改 patch 文件触发热重组。
