# XTU-CHANGES — xtu/main 分支改动清单

记录 `xtu/main` 相对于上游 `main` 的所有改动，按功能分类。
**维护规则**：每次有新提交合入 `xtu/main`，必须同步更新此文件。

> 生成方式：`git log origin/main..xtu/main --format="%h %ai %s"`
> 最后更新：2026-03-06

---

## 🔍 Diagnostics: OAuth Refresh Logging (03-11)

| Hash         | 时间  | 摘要                                                        |
| ------------ | ----- | ----------------------------------------------------------- |
| `950b3b8dae` | 03-11 | diag: add OAuth refresh diagnostic logging to auth-profiles |

---

## 🔌 Temp: GPT-5.4 Forward-Compat (xtu/develop only, pending upstream #36966)

临时 cherry-pick PR #36966（yuweuii），待上游合入后回退。

| Hash         | 时间  | 摘要                                                           |
| ------------ | ----- | -------------------------------------------------------------- |
| `1657f8b12e` | 03-06 | feat(models): add openai-codex gpt-5.4 forward-compat fallback |
| `c95b7988f9` | 03-06 | feat(models): surface openai-codex gpt-5.4 aliases in catalog  |

---

## 🔒 缓存稳定性 (Cache Stability)

解决 Anthropic 前缀缓存失效问题——确保同一 session 的连续请求中 system prompt 结构稳定。

| Hash         | 时间        | 摘要                                                                                                                  |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `9b9b2da4c0` | 03-06 10:20 | fix(cache): system event 从 SP 移至 user message，消除 exec/wake/reaction 等事件触发的全量 cache 失效                 |
| `1d092a88a9` | 03-03 19:02 | fix: announce turn 注入群聊上下文（Group Chat Context），消除 announce 路径 SP 与正常 turn 的差异                     |
| `24c275ee8e` | 03-03 13:31 | fix: 6 个内部 callGateway 路径补充 senderIsOwner=true（subagent announce/sessions_send/subagents steer/ACP spawn 等） |
| `83b8cde519` | 03-04 18:49 | fix: 移除 gateway agent params 中多余的 senderIsOwner（cleanup）                                                      |
| `68622cc847` | 02-27 20:24 | fix(cache): cron isolated、A2A、subagent 路径补充 senderIsOwner=true                                                  |
| `13bdb4d4a7` | 02-26 12:06 | fix(cache): 恢复 heartbeat group context replay（Provider/ChatType/GroupSubject 等）                                  |
| `c0ff639fca` | 02-26 11:50 | fix(cache): heartbeat replyOpts 传 senderIsOwner=true                                                                 |
| `100919c46f` | 02-26 12:58 | fix: 修复 merge artifact（sessions-patch.ts 缺 import）                                                               |
| `7c6962af09` | 02-26 13:08 | fix: test type assertion for mock AgentMessage                                                                        |
| `a6bb673dae` | 02-26 13:59 | fix: heartbeat 测试更新，Provider 期望从 "heartbeat" 改为真实 channel                                                 |
| `faef8b8af8` | 02-26 10:46 | fix(cache): 禁用 workspace 文件缓存，跨 session 修改立即生效                                                          |
| `c400cc2544` | 02-26 03:42 | fix(cache): 群聊 heartbeat/inject sender 改用 lastTo（群组地址），修复 activation 解析                                |
| `c0bdeb37b3` | 02-25 23:31 | fix(cache): 群聊始终注入 groupIntro，消除首 turn only 导致的 SP 不一致                                                |
| `ba8db06326` | 02-25 14:46 | fix(cache): 系统触发 turn 传 senderIsOwner=true，防止 owner-only 工具被剥离导致 SP 变化                               |
| `e76dc70a4f` | 02-24 04:50 | fix: 稳定 SP 结构——始终输出 section header + 占位文字，skills 排序                                                    |
| `0da38211d7` | 02-23 20:55 | fix: gateway agent 和 cron isolated 路径传入 ownerNumbers                                                             |
| `5b7c0315e6` | 02-19 00:09 | feat(infra): heartbeat/inject-turn 回放群聊上下文，对齐用户触发的 SP                                                  |
| `57350e8603` | 02-20 02:26 | fix(compaction): 禁用 compaction 中的 tool-result context guard，防止缓存浪费                                         |
| `39c2828f5b` | 02-18 05:36 | fix(inbound-meta): 从 SP 中移除 inbound meta（message_id 等），消除逐消息缓存失效                                     |
| `3044d886e9` | 02-27 14:09 | fix: compaction dump 目录用绝对路径（`~/`），修复 CWD 相对路径写错位置                                                |

---

## 🤖 ACP / Sub-agent 增强

ACP 工作流、子代理调度、thread projection 等。

| Hash         | 时间        | 摘要                                                                                                       |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `f00897f3aa` | 03-06 03:09 | fix(subagent): restore workflow mode gate for non-thread channels                                          |
| `69ec716079` | 03-06 00:12 | fix(subagent): fix thread projection routing and task prompt delivery                                      |
| `1c74c872e0` | 03-05 00:35 | feat(subagent): add thread projection for workflow runs                                                    |
| `91243c049d` | 03-04 10:09 | feat(acp): persist thread projection config for follow-up turns                                            |
| `7a11ebed76` | 03-04 08:10 | feat(acp): improve thread projection — fire-and-forget events, serial queue, task prompt, terminal summary |
| `ce500f1ccd` | 03-04 04:39 | fix(acp): add missing idempotencyKey to thread projection send calls                                       |
| `9bc1db6e09` | 03-04 03:27 | feat(acp): thread projection for workflow mode (B+ plan)                                                   |
| `ab1f1a2f57` | 03-01 05:20 | fix(acp): pass agentId to transcript persist（ACP sessions use codex agent store）                         |
| `314813ac14` | 03-01 05:10 | fix(acp): persist ACP output to transcript instead of memory-only cache                                    |
| `12b47f12be` | 03-01 01:08 | feat(acp): wire announceMode=workflow through ACP spawn path                                               |
| `49fae5dd85` | 02-28 11:45 | fix: deliver workflow announce turn replies to user                                                        |
| `e37455ebbb` | 02-27 20:27 | fix: restore ACP description text and update test for announceMode merge                                   |
| `f7a5104856` | 02-24 16:30 | feat(subagent): restore workflow announceMode on upstream spawn/announce architecture                      |
| `291ec2faef` | 02-25 12:06 | fix(subagent): restore delivery for workflow mode announce turns                                           |
| `73b9490e2f` | 02-24 16:30 | fix(tests): align test assertions with xtu/main customizations                                             |
| `bdcac6149f` | 02-22 23:20 | fix(subagent): workflow 模式 announce 使用 fire-and-forget，防止重复注入                                   |
| `02dc0f64f1` | 02-22 03:10 | feat: sessions_spawn 工具添加 announceMode 参数                                                            |
| `050ef34cf2` | 02-21 19:18 | fix(subagent): wake requester session after completion direct send                                         |
| `b910710af9` | 02-21 20:00 | merge: fix subagent announce wake requester session                                                        |
| `04b19c7df3` | 02-21 20:00 | merge: xtu/develop 子代理 announce 修复                                                                    |

---

## ⏰ Cron / Wake / Inject 基础设施

系统触发（定时任务、唤醒、消息注入）相关的核心能力。

| Hash         | 时间        | 摘要                                                                      |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| `74269bfc6d` | 03-06 13:08 | fix(cron): hide agent-turn from wake mode tool description                |
| `a2e76f2641` | 03-06 01:20 | fix(heartbeat): preserve original wake reason on retry                    |
| `05c44e49c9` | 03-02 13:43 | fix(inject-turn): support agent sessions without external delivery target |
| `18a78c8106` | 02-22 03:59 | feat(cli): system event 命令支持 agent-turn 模式和 --session 参数         |
| `0e721e5296` | 02-18 05:30 | feat(infra): 添加 session inject-turn，支持定向唤醒和流式响应             |
| `2d476504d6` | 02-19 02:43 | feat(commands): 添加 /warm on\|off，ticker 驱动的缓存保活                 |
| `876c72183e` | 02-19 02:58 | fix(commands): /warm ticker job 包含 gatewayUrl                           |
| `330242cceb` | 02-19 12:03 | feat(warm): /warm ticker job 包含 tokenFrom，支持多环境认证               |

---

## 📊 可观测性 / 诊断 (Observability)

日志、计时、payload 记录等诊断能力。

| Hash         | 时间        | 摘要                                                      |
| ------------ | ----------- | --------------------------------------------------------- |
| `3ddf009de0` | 02-19 01:55 | feat(diagnostics): 添加 per-session Anthropic payload log |
| `2f1140e038` | 02-22 13:47 | feat: payload log 拆分为 per-run 文件                     |
| `f9a379bb9a` | 02-19 02:10 | fix(diagnostics): 在 Zod config schema 中注册 payloadLog  |
| `2be4d21f8a` | 02-23 14:45 | feat: 导出 compaction 请求 payload 用于离线分析           |
| `072c855fdb` | 02-23 00:41 | feat: 添加 compaction 计时打点                            |
| `3d7a4e5c87` | 02-20 10:54 | debug: Telegram 延迟调查的详细计时日志                    |
| `415a5986df` | 02-20 10:54 | feat: 添加 Telegram delivery 可观测性日志                 |
| `3e5379077e` | 02-22 03:33 | restore: 恢复 Telegram delivery 计时日志                  |

---

## 💬 Usage 展示增强

| Hash         | 时间        | 摘要                                                                     |
| ------------ | ----------- | ------------------------------------------------------------------------ |
| `306e7f2421` | 03-17       | feat: extended usage footer (model/profile/thinking/weekly-limit)        |
| `d79fabc262` | 03-09       | feat(agent-defaults): add responseUsageByChannel for per-channel control |
| `74900d08e4` | 03-05 10:40 | fix(usage): restore context percentage in usage footer                   |
| `7ad9a4e509` | 03-04 19:01 | fix(usage): fall back to config default for responseUsage                |
| `b0ac7cbd78` | 03-04 18:16 | fix(usage): restore usage footer for block-streaming runs                |
| `5589b611e9` | 02-21 18:11 | feat: usage 行显示上下文使用百分比                                       |
| `e6d0344898` | 02-21 20:08 | fix: 上下文使用百分比使用 lastCallUsage                                  |
| `375c8cf1d7` | 02-18 05:28 | feat(usage): usage 展示增加缓存统计和费用                                |
| `d4ff1f53c3` | 02-18 05:29 | feat(config): 添加全局 responseUsage 默认值配置                          |
| `216d7cfae5` | 02-18 05:29 | fix(session): 持久化 responseUsage 和 session 配置的 off 状态            |

---

## ⚙️ 配置 / 会话管理

| Hash         | 时间        | 摘要                                                                   |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| `ac4f636544` | 02-28 03:12 | fix(auth): clear runtime auth profile snapshot after save              |
| `b73dd8e437` | 02-23 00:41 | feat: 添加 reasoningDefault 配置 + 修复 reasoning/verbose off 的持久化 |

---

## 🔌 平台集成 (Telegram / Feishu / Skills)

| Hash         | 时间        | 摘要                                                                    |
| ------------ | ----------- | ----------------------------------------------------------------------- |
| `44744c38d9` | 03-17       | feat: fire message:skipped internal hook on requireMention skip         |
| `ffac73ebe9` | 03-03 23:07 | fix(skills): resolve chokidar v5 glob incompatibility                   |
| `d4af0baaa5` | 03-05 11:06 | fix(feishu): remove duplicate replyInThread property from config schema |
| `5d333c5d13` | 02-18 05:32 | feat(telegram): 添加 steer middleware，支持向活跃 run 注入消息          |
| `c39efeb860` | 02-19 13:34 | fix(telegram): native command 路径添加 Provider 和 buildGroupLabel      |
| `4948ae7527` | 02-18 05:32 | feat(feishu): 添加 replyInThread 配置，支持话题线程回复                 |

---

## 🔧 类型 / 杂项修复

| Hash         | 时间        | 摘要                                                                          |
| ------------ | ----------- | ----------------------------------------------------------------------------- |
| `71aab2cecb` | 03-05 10:59 | fix(types): add missing acpThreadProjection to agent request type declaration |
| `7bd4ed5f7a` | 03-05 11:12 | fix(tlon): use HTTPS git URL for api-beta dependency                          |

---

## 🛡️ 运行时保护

| Hash         | 时间        | 摘要                                         |
| ------------ | ----------- | -------------------------------------------- |
| `e4d1cf69b0` | 02-18 05:32 | feat(pi-ext): 添加 compaction-safeguard 扩展 |

---

## 📊 可观测性 / Diagnostics

| Hash         | 时间  | 摘要                                                              |
| ------------ | ----- | ----------------------------------------------------------------- |
| `8f6e796681` | 03-08 | feat(payload-log): record authProfileId in each payload log entry |

---

## 🛠️ 开发工具 / Git Hooks

| Hash         | 时间  | 摘要                                                                              |
| ------------ | ----- | --------------------------------------------------------------------------------- |
| `441f77ebaf` | 03-07 | feat(git-hooks): add post-commit and post-merge reminder hooks for XTU-CHANGES.md |

---

## 🔀 Merge 提交

上游同步和分支合并（不含功能代码）。

| Hash         | 时间        | 摘要                                                                             |
| ------------ | ----------- | -------------------------------------------------------------------------------- |
| `110932afcf` | 03-06 10:06 | Merge branch 'xtu/main' into xtu/develop                                         |
| `bfb5d70250` | 03-06 02:01 | Merge remote-tracking branch 'tuyunlei/xtu/main' into xtu/develop                |
| `f2ce6cbbe4` | 03-06 01:11 | Merge branch 'xtu/main' into xtu/develop                                         |
| `186b861700` | 03-04 13:51 | merge: origin/main (1305 commits) into xtu/develop                               |
| `08b17b2c76` | 03-04 10:44 | Merge feature/acp-thread-projection into xtu/develop                             |
| `d43ffe5599` | 03-01 22:20 | merge: origin/main (178 commits) into xtu/main                                   |
| `6519db3856` | 02-27 18:17 | merge: origin/main (417 commits) into xtu/develop                                |
| `30284f67a3` | 02-27 18:26 | docs: update CHANGELOG for 2026.2.27                                             |
| `ec981715e4` | 02-25 14:47 | Merge branch 'xtu/develop' into xtu/main                                         |
| `c5abb6027b` | 02-26 11:05 | Merge origin/main into xtu/develop (491 commits)                                 |
| `9b21ce865c` | 02-24 12:22 | merge: main → xtu/main（上游同步）                                               |
| `0cae29077f` | 02-24 11:07 | Merge feature/agent-owner-numbers into xtu/main                                  |
| `5d9e9e7d8f` | 02-22 13:47 | Merge xtu/develop into xtu/main                                                  |
| `b3562114ab` | 02-21 21:17 | Merge main into xtu/main（上游同步）                                             |
| `3128fc881b` | 02-21 00:15 | Merge feat/delivery-logs into xtu/develop                                        |
| `0bf17d477b` | 03-09       | fix: pass cwd param to subagent spawn workspaceDir                               |
| `e808b55140` | 03-14       | diag: add OAuth refresh failure logging for multi-agent token conflict detection |
| `925a22476d` | 03-14       | fix: update Pi SDK patch for generateSummary onPayload (v0.57.1 compat)          |
