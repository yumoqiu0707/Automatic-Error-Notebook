# 错题集生成与知识点拓展助手

> **菜就多练！** —— 错一道，练三道。今天的错题，就是明天的送分题。

面向学习类小程序的**两阶段错题处理**应用，带**按科目归类的自动保存错题集**，可打包成**免安装桌面应用**，**手机扫码就能用**。

喂给它一道题（文字或图片），它会识别题目、给出正确答案与详细解析、错因分析、知识点复习，并生成 2–3 道同类型变式题；变式题的答案锁在服务端，用户提交作答后才开放批改。**每道题都会自动归到对应科目下**，可筛选、可标注掌握程度、可写笔记、可导出。

---

## 一、四种用法，按场景挑

| 方式 | 适合谁 | 需要装 Node.js 吗 |
|---|---|---|
| **A. 免安装 exe（下载即用）** | 想装在自己电脑上 / 发给别人 | ❌ 不需要 |
| **B. 手机扫码使用** | 拍错题、随身复习 | ❌ 不需要（电脑跑 A 即可） |
| **C. 双击启动脚本** | 在源码目录里快速用 | ✅ 需要 |
| **D. 安装成桌面应用（PWA）** | 想要独立窗口、没有黑窗口 | ✅ 需要 |

### A. 免安装桌面应用（单文件 exe）

`dist\错题集助手\` 就是可以直接分发的软件目录：

```
错题集助手\
├── 错题集助手.exe      主程序（83 MB，Node 运行时已打进去）
├── public\             前端资源
├── config.example.json 配置模板
├── 使用说明.txt
└── data\               你的错题集（首次运行自动创建）
```

**双击 `错题集助手.exe`** → 浏览器自动打开 → 填模型配置 → 开始用。关掉那个命令行窗口就是退出。

- 把整个文件夹压缩（`dist\错题集助手-v1.1-win64.zip`，33 MB）发给任何人，对方**不需要装 Node.js**，解压双击就能跑。
- 数据存在 exe 同目录的 `data\db.json`，换电脑直接拷 `data` 文件夹。
- 想改端口：命令行里 `set PORT=5190` 后再运行 exe。
- 想禁止自动开浏览器：加 `--no-open` 参数。

**自己重新打包**（改完源码后）：

```bash
cd 错题集助手Demo
mkdir -p build && cd build && npm install postject resedit @napi-rs/canvas jsqr --no-save && cd ..
node make-icons.js        # 可选：重新生成图标
node build-exe.js         # 打包成 exe（自动把图标和版本信息写进 PE）
```

原理见下方「关于打包」。

### B. 手机端使用（拍照做错题最方便）

手机端**不需要装任何东西**，也不需要装 Node —— 手机只是通过浏览器连到电脑上运行的程序。

**步骤：**

1. 手机和电脑连**同一个 Wi-Fi**
2. 电脑上程序保持运行
3. 电脑浏览器里点页面右上角**「手机访问」** → 弹出二维码
4. 用手机相机或微信「扫一扫」扫描 → 打开网页
5. 点浏览器菜单 →**「添加到主屏幕」** → 以后从桌面图标进入，用起来和 App 一样

**能做什么：** 手机直接拍错题上传 → 生成解析和同类型题 → 自动存进错题集。**手机和电脑看到的是同一份错题集**（数据存在电脑上）。

**几个要注意的点：**

- **电脑必须开着且程序在运行**，手机才能访问。手机不是独立运行的。
- 首次运行时 Windows 会弹防火墙询问框，**要选「允许」**，否则手机连不上。
- 局域网是 `http://` 不是 `https://`，所以手机浏览器**不会提供"安装应用"**（Service Worker 要求 HTTPS），但「添加到主屏幕」的快捷方式一样好用。
- **同一 Wi-Fi 下的其他人也能打开这个网址**。在家里没问题；在公共 Wi-Fi（咖啡厅、学校）建议把 `config.json` 里的 `"host"` 改成 `"127.0.0.1"` 关掉局域网访问。
- 想知道手机访问时是什么效果，直接在电脑浏览器里访问启动时打印的那个 `http://192.168.x.x:5178` 地址即可。

### B2. 分享给朋友（公网网址，朋友不用装任何东西）

不在同一个 Wi-Fi、朋友只用手机 —— 用这个。它会把本机服务变成一个**公网 HTTPS 网址**，发给朋友点开就能用。

```bash
node share.js                 # 随机口令
node share.js --code 888888   # 指定访问口令
node share.js --off           # 关掉口令，恢复本机自用
```

或者直接双击 **`分享给朋友.bat`**。运行后会打印：

```
把这个链接发给朋友：

https://grsst-112-2-253-90.free.pinggy.net/?code=246810
```

同时自动生成二维码页面并打开浏览器，扫码或复制链接都行。**这个窗口不能关，关了网址就失效。**

**两条通道，自动选择：**

| 通道 | 条件 | 时长 | 备注 |
|---|---|---|---|
| **SSH（pinggy）** | 系统自带 `ssh.exe`，零下载 | **60 分钟后失效** | 网址里会带你的公网 IP，在意隐私别用 |
| **cloudflared** | 需放一个 `tools\cloudflared.exe` | 不限时 | 网址是随机域名，不暴露 IP。下载地址见脚本里的提示 |

优先用 cloudflared；没有就自动退回 SSH 通道。

**访问口令（重要）**

只要把网址发出去，任何拿到的人都能用你的 API 额度 —— Cloudflare/pinggy 的随机域名也会被扫到。所以分享前必须开口令：

- `share.js` 会把 `access_code` 写进 `config.json`，**需要重启「错题集助手」才生效**
- 验证通过后种一个 180 天的 HttpOnly Cookie，Cookie 里存的是哈希不是明文口令
- 你自己本机访问也会被拦，但启动时自动打开的链接自带 `?code=`，拿到 Cookie 之后就无感了
- 不想用了跑 `node share.js --off`

**必须知道的三个代价：**

1. **你的电脑得一直开着**。关机或关掉程序，朋友的链接立刻失效。
2. **朋友做的错题会进你的错题集**（存你电脑的 `data/db.json`，和你自己的混在一起）。
3. **朋友用的是你的 API 额度**。

这三条决定了它只适合"临时分享试玩"。要让朋友长期随时可用，得把它部署到一台公网服务器上。

### C. 双击启动脚本（源码目录）

| 文件 | 作用 |
|---|---|
| **`启动错题集助手.bat`** | 启动服务并自动打开浏览器。**关闭窗口 = 停止服务**（数据已自动保存）。 |
| **`启动错题集助手（无窗口）.vbs`** | 后台静默启动，不弹黑窗口。 |
| **`停止错题集助手.bat`** | 结束后台运行的服务。 |

脚本会自动在 PATH 和几个常见安装位置里找 node；找不到会给出提示和下载地址。重复双击也没关系——检测到服务已在运行时会直接帮你打开浏览器，不会报错。

> **脚本维护提醒**：`.bat` / `.vbs` 必须是**纯 ASCII + CRLF 行尾**。cmd.exe 按系统代码页读取批处理文件，一旦混入 UTF-8 中文就会乱码、行被拆断、语句错乱。所有中文提示都写在 `server.js` 里由 Node 输出。

### D. 安装成桌面应用（PWA）

用 Chrome / Edge 打开 <http://127.0.0.1:5178>，地址栏右侧会出现**安装图标**（或点页面右上角自动出现的「安装到桌面」按钮）。装完之后：

- 桌面 / 开始菜单出现独立图标，双击即开
- 独立窗口运行，没有浏览器地址栏
- 右键任务栏图标有「我的错题集」快捷入口

> **不配 API Key 也能用**：页面会自动切到**手动模式**——把生成的请求复制给任意大模型（包括对话式 AI），再把返回的 JSON 粘回来，同样能渲染并保存。

首次启动已内置 6 道**示例错题**（数学 3 / 物理 2 / 英语 1，都带「示例」标签），方便你直接看到错题集长什么样，在「我的错题集」里逐条删除即可。

---

## 二、错题集：按科目归类 + 自动保存

### 归类方式

错题集分两层：

```
科目（一级）          知识点（二级，可开关）
├── 数学  3 道
│   ├── 一元二次方程根的判别式   1
│   ├── 完全平方公式的变形       1
│   └── 分式方程的增根           1
├── 物理  2 道
│   ├── 欧姆定律                 1
│   └── 电功率                   1
└── 英语  1 道
    └── 现在完成时               1
```

- **科目导航条**：一眼看到每个科目有多少题、多少待复习，点击只看某一科
- **科目分组卡**：头部汇总该科目的「待复习 / 已掌握 / 总题数 / 掌握度进度条」，点击可折叠
- **组内按知识点细分**：工具栏的开关打开后，科目下面再按知识点分子组
- 科目与知识点的颜色固定，同名科目永远是同一个色

### 保存机制

| 能力 | 说明 |
|---|---|
| **自动保存** | 每次识别成功、每次批改完成，都会立即写入 `data/db.json`。不需要点"保存"。 |
| **原子落盘** | 先写 `.tmp` 再 `rename`，断电或强杀进程不会写出半个损坏的文件。 |
| **退出保护** | 收到 `Ctrl+C` / SIGTERM 时先强制落盘再退出。 |
| **每日备份** | 每次落盘顺带生成 `data/backups/db-YYYY-MM-DD.json`，保留最近 30 天。 |
| **重启不丢** | 关掉服务再打开，错题、作答、批改结果、笔记、标签全在。已实测验证。 |
| **自动去重** | 按题干指纹（SHA1）识别同一道题：再次做错只累加「错题次数」，不新增条目，同时保留每次的时间与作答。 |
| **批改自动回写** | 提交变式题后，掌握程度、复习次数、每次作答记录、正确率历史自动更新到对应错题上。 |
| **可导出** | Markdown（按「科目 · 知识点」分组，适合打印）/ CSV（Excel）/ JSON（完整备份）。 |

掌握程度由批改结果自动推导，也可以手动改：

- 全部答对 → `掌握`
- 答对一半及以上 → `基本掌握`
- 其他 → `未掌握`

「待复习」= 未掌握 / 基本掌握 / 待批改，且距上次复习超过 3 天。

---

## 三、目录结构

```
错题集助手Demo/
├── 启动错题集助手.bat            ← 双击启动（需装 Node）
├── 启动错题集助手（无窗口）.vbs   ← 静默启动
├── 停止错题集助手.bat            ← 停止后台服务
├── server.js              本地服务：静态托管 + 业务接口 + 模型调用 + 校验
├── system-prompt.js       交付版 System 提示词原文 + 消息组装（改提示词改这里）
├── db.js                  数据层：错题集持久化、科目汇总、去重、统计、导出
├── qr.js                  自研二维码生成器（零依赖，用于手机扫码访问）
├── paths.js               应用根目录解析（兼容源码形态与 exe 形态）
├── build-exe.js           打包成免安装 exe（SEA + postject + resedit 写图标和版本信息）
├── make-icons.js          生成应用图标（封面图 + 标语，PNG + ICO，需 @napi-rs/canvas）
├── share.js               一键分享：建公网隧道 + 访问口令 + 二维码（cloudflared 或 SSH）
├── 分享给朋友.bat          双击即可开始分享
├── config.example.json    配置模板
├── public/
│   ├── index.html         主界面：封面 / 生成错题集 / 我的错题集
│   ├── manifest.webmanifest  PWA 清单（安装成桌面应用）
│   ├── sw.js              Service Worker（离线打开外壳，不缓存接口）
│   ├── assets/cover.jpg   封面图
│   └── icons/             应用图标（封面图 + 「菜就多练！」，由 make-icons.js 生成）
│       ├── icon-192.png  icon-512.png   PWA 用的 PNG
│       └── app.ico                    exe 用的多尺寸 ICO（16/24/32/48/64/128/256）
├── dist/                  ← 打包产物（可分发）
│   ├── 错题集助手/         免安装应用目录（含 app.ico 写的图标）
│   └── 错题集助手-v1.1-win64.zip   33 MB，发给别人解压即用
├── data/
│   ├── db.json            你的错题集（运行时生成，含 server_only）
│   └── backups/           每日自动备份
├── build/                 打包中间产物（bundle.js / sea-prep.blob / postject）
├── test-api.js            接口契约测试（24 项）
├── test-e2e.js            端到端测试（23 项）
├── test-persistence.js    错题集持久化测试（48 项）
├── test-render.js         前端渲染测试（28 项）
├── test-qr.js             二维码生成器测试（13 项，用 jsqr 反向解码验证）
├── test-share.js          分享能力测试：访问口令 + 公网地址（27 项，隔离目录运行）
└── test-exe.js            打包版 exe 独立运行测试（15 项）
```

想重新生成图标（需要先在 `build/` 里装 `@napi-rs/canvas`）：

```bash
cd build && npm install @napi-rs/canvas --no-save && cd ..
node make-icons.js        # 输出到 public/icons/
node build-exe.js         # 重新打包时自动把 app.ico 写入 PE
```

---

## 三点五、关于打包（为什么能做成免安装 exe）

用的是 **Node.js 的 SEA（Single Executable Application）** 特性，不需要 Electron，也不需要下载任何大体积工具链：

1. `build-exe.js` 把 `server.js` / `db.js` / `system-prompt.js` / `paths.js` 用自写的小 bundler 捆成一个文件（处理 `require('./xxx')` 的相对路径解析，内置模块直通 Node 原生 require）
2. `node --experimental-sea-config` 生成 `sea-prep.blob`
3. 复制 `node.exe`（83 MB），用 `postject` 把 blob 注入进去，得到单文件 `错题集助手.exe`
4. 再用 `resedit` 把 `public/icons/app.ico`（封面图 + 「菜就多练！」，7 个尺寸）写进 PE 资源段，同时写入 FileVersion / ProductName / FileDescription 等版本信息——文件管理器、任务栏、安装包里看到的图标就是应用图标本身了。

**关键点：路径不能靠 `__dirname`。** SEA 环境下 `__dirname` 不可靠，所以 `paths.js` 用「`process.execPath` 所在目录下有没有 `public/index.html`」来判断应用根目录，兼容 `node server.js` 和 exe 两种形态。已验证：把 exe 的工作目录设成 `C:\` 运行，它依然能正确找到自己旁边的 `public/`，数据也写在 exe 旁边而不是 C 盘。

**分发时不会带上你的 API Key**：`config.json` 不在打包清单里，别人拿到的是干净的、需要自己填 Key 的版本。

**为什么还留着一个黑窗口**：exe 用的是控制台子系统，好处是能看日志、关掉窗口即退出。想做成完全无窗口的形态，需要把 PE 头的 Subsystem 从 3（console）改成 2（GUI），代价是关不掉、只能去任务管理器结束进程。当前保留控制台是有意的取舍。

---

## 四、支持的模型

任何 **OpenAI 兼容**接口都可以。页面内置了常用预设：

| 服务商 | Base URL | 推荐模型 | 视觉 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ✅ |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | ✅ |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-plus` | ✅ |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k-vision-preview` | ✅ |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` | ✅ |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | ❌ 仅文字 |
| Ollama（本地） | `http://127.0.0.1:11434/v1` | `qwen2.5vl:7b` | ✅ |

**要用图片识别必须选支持视觉的模型**；纯文字模型请用「粘贴题目文字」入口。

---

## 五、接口

### 两阶段主流程

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 服务与模型配置状态（含错题总数） |
| GET/POST | `/api/config` | 读取 / 保存模型配置（Key 只存本地 `config.json`） |
| GET | `/api/system-prompt` | 读取完整 System 提示词 |
| POST | `/api/initial` | 阶段一：传题目 → 识别 + 解答 + 生成变式题 + **自动入错题集** |
| POST | `/api/grade` | 阶段二：传作答 → 依据锁定答案批改 + **自动回写错题集** |
| POST | `/api/manual-prompt` | 组装可直接复制给任意模型的请求 |
| POST | `/api/ingest` | 手动模式：把模型返回的 JSON 提交进来做校验与落库 |
| GET | `/api/records/:id` | 后端视角，用于演示面板查看 `server_only` |

### 错题集

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats` | 统计：总数、涉及科目数、按学科/掌握程度分布、待复习数、近 7 天新增 |
| GET | `/api/subjects` | **科目汇总**：每个科目的题数、待复习数、已掌握数、掌握度、知识点分布 |
| GET | `/api/mistakes` | 列表。支持 `q` `subject` `topic` `tag` `starred` `from` `to` `sort` `limit` `offset` |
| GET | `/api/mistakes/:id` | 单条详情 |
| PATCH | `/api/mistakes/:id` | 修改 `mastery` / `starred` / `tags` / `note` |
| DELETE | `/api/mistakes/:id` | 删除 |
| GET | `/api/export?format=md\|csv\|json` | 导出，支持与列表相同的筛选参数 |

阶段一请求体：

```json
{ "text": "1. 已知 a+b=5，ab=6，求 a²+b² 的值。", "image": null, "subject_hint": "数学", "grade_level": "初二" }
```

阶段二请求体：

```json
{
  "record_id": "rec_xxx",
  "submitted_answers": [
    { "mistake_id": "m1", "question_id": "m1_q1", "answer": "29" }
  ]
}
```

---

## 六、已实现的交付版硬规则

| 规则 | 实现位置 |
|---|---|
| `user_visible` 只返回前端，`server_only` 只存服务端 | `/api/initial` 只回 `userVisible`；落库到 `data/db.json` |
| `locked_solutions` 禁止出现在任何前端响应中 | 除 `/api/records/:id`（演示面板专用）外，任何接口都不返回 |
| 返回必须做 JSON Schema 校验，失败重试一次，再失败返回业务异常 | `validateInitial` / `validateGrade` + 重试循环，失败返回 `422 SCHEMA_FAIL` |
| 同一图片按 `img_hash` 缓存，避免重复消耗 token | `imgCache`，命中后直接返回原记录并标记 `cached: true` |
| 模型参数 `temperature=0.2` / `top_p=0.8` / `response_format: json_object` | `callModel`，可在配置里关掉 json mode |
| 提交作答时校验 `mistake_id` / `question_id` 是否存在 | `runGrade`，非法 ID 返回 `400 ILLEGAL_ID`（在检查 API Key 之前） |
| 未提交的同类型题答案继续锁定 | 只批改 `submitted_answers` 中出现的题目 |
| 阶段二不得重新生成标准答案 | 只把服务端存的 `locked_solutions` 传给模型 |
| 防提示注入 | 写在 System 提示词最高优先级规则第 1 条 |
| 额外：泄漏检测 | `detectLeak` —— `user_visible` 里若出现锁定答案，返回 `leakWarnings` 并在页面标红 |

---

## 七、测试

先启动服务（`node server.js`），再另开一个终端：

```bash
node test-api.js           # 24 项：Schema 校验 / 隔离存储 / 越权 / 泄漏检测 / 手动模式
node test-e2e.js           # 23 项：本地假模型端点跑通「调用→重试→落库→批改→缓存」
node test-persistence.js   # 48 项：自动保存 / 去重合并 / 批改回写 / 编辑 / 导出
node test-render.js        # 28 项：科目分组 / 科目筛选 / 知识点细分 / 折叠 / 筛选预设
node test-qr.js            # 13 项：二维码生成（用 jsqr 反向解码验证，含中文）
node test-share.js         # 27 项：访问口令 + 公网地址（自带隔离目录，不碰真实数据）
node test-exe.js           # 15 项：打包版 exe 能否独立运行（不需要先启动服务）
```

合计 178 项，全部通过。

- 所有断言都基于实际数据计算，可以随时重复运行，不会因为错题集里已有内容而误报。
- `test-e2e.js` 和 `test-persistence.js` 会临时把 `config.json` 指向本地假模型端点，跑完自动还原。
- `test-api.js` 在检测到已配置真实模型时会**跳过**最后一项，避免消耗你的 API 额度。
- `test-qr.js` 不是"看起来像二维码"就算过——它把生成的矩阵渲染成位图，**用 jsqr 真解码一次**，比对原文是否一致。
- `test-exe.js` 会把工作目录设成 `C:\` 再启动 exe，专门验证「程序靠 exe 位置找资源」而不是靠当前目录。

---

## 八、已知限制

- **泄漏检测只覆盖长度 ≥ 3 的答案**。像 `A`、`B` 这类选项字母太短，直接做子串匹配会大量误报，因此跳过；这类答案的防线是"模型本来就不会把它们写进 `user_visible`"。
- 图片识别完全依赖所选模型的视觉能力，没有内置 OCR。
- **科目名由模型判断**，偶尔可能把同一科目写成「数学」和「初中数学」两个科目。可以在错题集里改，或直接编辑 `data/db.json` 的 `subject` 字段。
- `data/db.json` 是单文件存储，适合原型与单机使用；上生产请换数据库，并把 `server_only` 单独建表加访问控制。
- 错题去重按题干指纹，题干被改写（哪怕只是标点不同）会视为两道不同的题。
- **打包版 exe 体积 83 MB**，因为整个 Node 运行时都打进去了（这是 SEA 方案的固有代价，比 Electron 的 150 MB+ 还是小不少）。压缩后 33 MB。
- **exe 目前只支持 Windows x64**，因为它是由本机的 `node.exe` 复制而来。要出 macOS / Linux 版本，需要在对应平台（或在 CI 里）用该平台的 node 跑一次 `build-exe.js`。
- **打包版会弹一个控制台窗口**（见上文「关于打包」的取舍说明）。想要完全无窗口，改用 PWA 安装方式。
- **打包版改提示词需要重新打包**，因为 `system-prompt.js` 被编译进 exe 了。改提示词请用源码版。
- **exe 的图标就是封面图 + 「菜就多练！」**，由 `make-icons.js` 生成、`build-exe.js` 用 `resedit` 写进 PE 资源段（7 个尺寸 16/24/32/48/64/128/256）。PWA / 浏览器标签页 / 手机主屏用的是同一套 PNG，桌面图标也是。
- **手机端不是独立 App**，是「手机浏览器连电脑」。电脑关机或程序退出后手机就打不开了。不在同一 Wi-Fi 时用 `node share.js` 开公网隧道（见 B2），但你的电脑仍必须一直开着。
- **分享链接是临时的**。SSH 通道免费版 60 分钟失效；cloudflared 虽不限时但每次重开网址都会变。要一个固定不变的网址，只能部署到公网服务器，或去 Cloudflare 申请一个命名隧道（需要账号）。
- **分享出去的接口仍然包含 `/api/records/:id`**（演示面板专用，会返回 `locked_solutions`）。开口令挡住了外人，但拿到口令的人理论上能读到锁定答案。真要对外提供服务，把这个接口关掉。
- **局域网是 HTTP 不是 HTTPS**，所以手机浏览器不会出现「安装应用」按钮，只能「添加到主屏幕」。要真正的 PWA 安装体验必须有 HTTPS。
- 未做代码签名，别人首次运行时 Windows SmartScreen 可能提示「未知发布者」，需要点「更多信息 → 仍要运行」。
- 本原型不含鉴权、限流与用量统计。**开放局域网访问时，同一 Wi-Fi 下任何人都能打开你的错题集并使用你的模型额度**，公共网络下请把 `host` 改回 `127.0.0.1`。`config.json` 里是明文 API Key，请勿提交到版本库。
