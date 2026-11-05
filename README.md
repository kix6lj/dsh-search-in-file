# dsh-search-in-file

> 在 DeepSeek Harness 右侧边栏里，对**打开的文件**和**本轮改动 diff** 做查找：
> 只高亮、不遮内容，支持全词与正则。

In-file search for the DeepSeek Harness right Sidebar: highlight matches in the
document preview and the changes-review diff, with whole-word and regex modes.

---

## 功能

- **文件预览**（纯文本 / Markdown / 代码）：搜索当前渲染出的内容，黄色高亮全部匹配，橙色高亮当前匹配；`Enter` / `Shift+Enter` 在匹配间跳转并滚动到可视区。
- **「第 N 轮改动」diff**：统一视图与分栏视图都能搜索；分栏时按行去重（新文件一侧优先，删除行回退旧侧），不会重复计数。
- **`Ctrl/Cmd+F`**：鼠标/指针最后停在预览或改动区时接管浏览器查找；在聊天输入框里仍使用浏览器查找。
- **选中即搜**：在预览或 diff 里选中一段文本后按 `Ctrl/Cmd+F`，查找框会自动填入所选内容（多行选择合并为一行）；查找框已打开时再次选中并按 `Ctrl/Cmd+F`，会用新选区替换当前关键字。
- **开关**：`Aa` 区分大小写、`W` 全词匹配、`.*` 正则表达式；三个开关按浏览器持久化。
- **正则**：使用浏览器原生 `RegExp`（ECMAScript），支持跨语法高亮 span 匹配；`^` / `$` 按行/段落锚定；非法正则输入框变红，悬停显示原生错误信息。
- **只高亮，不弹候选列表**：不会遮住正文；不修改 DOM、不移动选区，因此输入框始终保留焦点。

## 安装

需要 DSH 0.2.x 的 Web profile（`dsh web`）。

```bash
dsh plugin --profile web add git+https://github.com/kix6lj/dsh-search-in-file.git
```

安装后刷新页面即可；插件是纯客户端模块，不需要重启 `dsh web`。

手动安装（不想用 plugin manager 时）：

1. 把仓库放到 `$DSH_HOME/profiles/web/node_modules/dsh-search-in-file`（或在该目录做符号链接）；
2. 在 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-search-in-file
      name: dsh-search-in-file
```

3. 刷新页面。

## 使用

打开文件预览或「第 N 轮改动」标签，工具栏（「打开方式」和刷新图标之间）会出现 🔍：

| 操作 | 效果 |
| --- | --- |
| 点 🔍 / `Ctrl/Cmd+F` | 打开查找条；有选中文本时自动填入 |
| 输入关键字 | 实时高亮全部匹配，并滚到第一个匹配 |
| `Enter` / `Shift+Enter` | 下一个 / 上一个匹配 |
| `Aa` | 区分大小写 |
| `W` | 全词匹配（两侧不能是字母、数字或下划线；`data-review-tool` 里的 `review` 算整词） |
| `.*` | 正则表达式；与 `W`、`Aa` 可组合 |
| `Esc` / × | 关闭并清除高亮 |

## 实现

- 搜索区域按块（代码行 / 段落 / 表格单元格等）扁平化成一段文本：同一块内跨语法 span 拼接，块与块之间插入换行；匹配后把字符区间映射回 DOM `Range`。
- 正则直接使用浏览器原生 `RegExp`，标志为 `g` +（`i`）+ `m`，没有自带正则引擎。
- 高亮使用 **CSS Custom Highlight API**，不插入 `<mark>`，不改动 React 管理的 DOM，也不调用 `Selection`，所以输入框不会失焦。
- 需要支持 Highlight API 的浏览器：Chrome/Edge 105+、Safari 17.2+、Firefox 140+。

## 限制

- 只搜索**已渲染**的内容；长文件的分页预览需要先加载更多（或滚动）再搜。
- HTML **渲染**预览、PDF、图片、Office/Excel 不支持；HTML 想搜源码，可把查看器切到「纯文本」。
- Markdown 的 `^` / `$` 锚定渲染段落，而不是源码行（软换行会合并成段）。
- 正则由浏览器主线程执行，复杂表达式在超大文件上可能卡顿；单次搜索最多收集 1000 个匹配。
- 没有构建步骤；客户端模块是单文件 ESM，样式在运行时注入。

## 开发

仓库即源码：

- `index.js` — Host 半，只负责让 profile 加载包；
- `client.js` — 客户端半，注册文件预览工具栏动作，并为每个「第 N 轮改动」标签注入查找条；
- `cordis.patch.yml` — 安装时插入插件行。

改完 `client.js` 后刷新页面即可（DSH 会按文件 mtime 重新打包插件 bundle）。

## License

MIT
