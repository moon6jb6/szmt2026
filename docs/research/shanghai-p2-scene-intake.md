# 淞沪会战 P2 首场景：史料与取景待确认包

状态：待内容审核确认；本文件不是史实内容库，不能直接作为游戏事实文本。

## 已核对的官方锚点

1. 上海淞沪抗战纪念馆官网（中国国家二级博物馆）
   - 主页：<http://www.813china.com/>
   - 抗战历史栏目：<http://www.813china.com/index.php?m=content&c=index&a=lists&catid=3>
   - 该站点公开提供“八一三抗战”专题入口、展馆信息与抗战历史栏目，适合作为首轮场景资料的馆藏线索。

## 仍待确认的史实字段

在把任何内容加入 `src/content` 前，请审核并确认以下字段：

| 字段 | 需要确认的内容 |
| --- | --- |
| 首场景 | 罗店争夺 / 大场防线 / 四行仓库与苏州河，三选一 |
| 时间范围 | 精确到可被来源支持的日期或日期范围 |
| 空间锚点 | 可核验的具体地点与时代对应关系 |
| 人物与部队 | 只保留来源明确支持者；否则采用无名、复合型角色并标注 |
| 可用图像 | 授权状态、出处、是否仅供取景参考 |

## 建议的首版取景策略

建议先做“低辨识度战场边缘 + 补给/撤离通道”的表现层，而非复刻一张历史照片或具体建筑。它可承载卡牌机制，又不会在审核前伪造部队、旗帜、标语、人物或伤亡画面。

- 前景：湿土、木制临时遮蔽物、散落且无文字的物资箱、模糊路径标记。
- 中景：低矮堤岸、烟尘、远处不具辨识度的城市/工事轮廓。
- 后景：阴天、烟层与低饱和水面；没有文字、制服徽记、尸体或可识别人物。
- 镜头：16:9 横向，略低机位，路径从左下进入中景，预留右下角 UI 安全区。

## 待审核的表现层提示词（不含史实断言）

```text
1930s China war-era memorial interpretation, a restrained logistics and evacuation corridor after rain,
muddy ground, weathered wooden field cover, plain unmarked supply crates, distant low earthworks and a hazy riverbank,
overcast late afternoon, muted rust red, smoke black, sand gold and paper white palette,
solemn documentary atmosphere, cinematic 16:9 wide frame, low viewpoint, clear negative space for interface,
no people, no faces, no corpses, no gore, no weapons close-up, no military insignia, no flags, no text, no signage,
no modern buildings, no advertisements, no fantasy, no propaganda poster style
```

该提示词只能生成表现层草图；通过审核后，才可将已确认的地点、时间、建筑形制和资产参考作为受控参数加入。

## 图像与资产规则

1. 在来源、版权/使用条件和审核人确认前，不下载或将馆藏、新闻或摄影作品放入项目资产目录。
2. 审核通过后，保存“原始参考链接 + 来源截图/文件名 + 使用范围 + 审核日期”到资产清单。
3. 生成图统一标为“AI 生成的历史情境复原，不等同于历史照片”。
4. 首版采用“固定生成图 + 已审核文字 + 2.5D 视差”资产包；不让运行时模型改写史实。
