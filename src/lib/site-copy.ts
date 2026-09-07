export type CopyField = {
  key: string;
  group: string;
  label: string;
  defaultValue: string;
  required: boolean;
  /** 用多行输入框编辑，空行分段。 */
  multiline?: boolean;
  description?: string;
};
export const copyFields: CopyField[] = [
  {
    key: "brand.name",
    group: "品牌信息",
    label: "站点名称",
    defaultValue: "上海交大守望先锋",
    required: true,
  },
  {
    key: "brand.badge",
    group: "品牌信息",
    label: "名称旁标识",
    defaultValue: "SJTU",
    required: false,
  },
  {
    key: "brand.subtitle",
    group: "品牌信息",
    label: "英文副标题",
    defaultValue: "SJTU OVERWATCH COMMUNITY",
    required: false,
  },
  {
    key: "brand.metaDescription",
    group: "品牌信息",
    label: "搜索引擎简介",
    defaultValue:
      "上海交大守望先锋玩家社区。参加校内内战、娱乐赛、训练赛与观赛活动，认识一起开黑的交大队友。",
    required: false,
  },
  {
    key: "home.eyebrow",
    group: "首页介绍",
    label: "首页顶部标语",
    defaultValue: "上海交大 · 守望先锋玩家社区",
    required: false,
  },
  {
    key: "home.title",
    group: "首页介绍",
    label: "首页主标题",
    defaultValue: "交大集结，\n\n一起守望。",
    required: true,
    multiline: true,
    description: "空一行表示换行显示；不空行就是同一行。",
  },
  {
    key: "home.title1",
    group: "首页介绍",
    label: "首页主标题（第一行）",
    defaultValue: "交大集结，",
    required: true,
  },
  {
    key: "home.title2",
    group: "首页介绍",
    label: "首页主标题（第二行）",
    defaultValue: "一起守望。",
    required: false,
  },
  {
    key: "home.description",
    group: "首页介绍",
    label: "首页介绍文字",
    defaultValue: "参加校内活动，认识一起开黑的交大队友。",
    required: false,
  },
  {
    key: "footer.text",
    group: "页脚信息",
    label: "页脚标语",
    defaultValue: "",
    required: false,
  },
  {
    key: "footer.note",
    group: "页脚信息",
    label: "页脚说明",
    defaultValue: "守望先锋玩家自发社区，与暴雪娱乐无隶属关系。",
    required: false,
  },
];

// Keep old keys valid so updating visible settings preserves stored content.
const retiredCopyKeys = new Set([
  "brand.badge",
  "brand.subtitle",
  "home.eyebrow",
  "footer.text",
  // 主标题原本拆成两行两个字段，现在合并成一个多行输入框。
  // 保留在 copyFields 里，旧配置里的值才不会被判成无效设置项。
  "home.title1",
  "home.title2",
]);
export const editableCopyFields = copyFields.filter(
  (field) => !retiredCopyKeys.has(field.key),
);
