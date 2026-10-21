/**
 * 人物剪影（纯内联 SVG，无图片、无 emoji）
 *
 * 用途：SceneBeats 在「这一组正文里出现了人」的段落后方，隐约放一个上半身剪影。
 * 约定：
 * - 只画上半身，躯干在画布底边被裁掉（viewBox 260 高，人物走到 y=260 就结束）。
 * - 粗粝边缘用「同一组图形错位描三遍」模拟，再交给 CSS 的 blur(1.5px) 收边；
 *   不用 feTurbulence 之类的滤镜，避免移动端逐帧重算。
 * - 纯色 currentColor，透明度与位置全部由外层 CSS 控制，组件本身不写 opacity。
 * - aria-hidden：剪影是氛围，不是内容；读屏不该念到它。
 *
 * 造型：
 * - male   —— 士兵：钢盔（盔顶 + 盔檐）、下颌、肩线、半个躯干。
 * - female —— 挽发：脑后发髻、头、左侧鼻梁与唇的侧脸起伏、较窄的肩线。
 */

export type SilhouetteVariant = 'male' | 'female'

export type SilhouetteFigureProps = {
  variant: SilhouetteVariant
  className?: string
}

/* ---- 士兵：钢盔 + 肩线 + 半个躯干 -------------------------------------- */

const MALE = (
  <>
    {/* 一整块盔形（盔顶 + 只外翻一指甲的盔檐 + 檐下的脸），比「圆 + 一根横条」更像钢盔 */}
    <path d="M100 24 C118 24 131 36 132 56 C133 68 130 76 128 82 L136 84 C139 85 139 90 135 91 L128 91 L128 96 C120 103 108 106 100 106 C92 106 80 103 72 96 L72 91 L65 91 C61 90 61 85 64 84 L72 82 C70 76 67 68 68 56 C69 36 82 24 100 24 Z" />
    {/* 脖子 */}
    <rect x="86" y="96" width="28" height="22" />
    {/* 肩线：肩峰在 y≈150 最宽，往下收到腰，躯干在画布底边被裁掉 */}
    <path d="M82 106 C72 110 61 115 52 122 C42 129 34 138 30 150 C27 160 26 171 26 185 L26 260 L174 260 L174 185 C174 171 173 160 170 150 C166 138 158 129 148 122 C139 115 128 110 118 106 Z" />
  </>
)

/* ---- 挽发女性：发髻 + 头 + 侧脸 + 肩 ----------------------------------- */

const FEMALE = (
  <>
    {/* 脑后发髻 + 一小缕收进去的发尾 */}
    <circle cx="123" cy="22" r="13" />
    <path d="M120 32 C128 40 129 54 125 68 C123 76 117 79 113 75 C119 64 121 46 114 36 Z" />
    <ellipse cx="104" cy="56" rx="25" ry="29" />
    {/* 侧脸：只在左缘点一下鼻梁与人中，不能画成尖角 */}
    <path d="M82 56 C79 60 77 65 77 68 C77 70 79 71 81 70 C83 69 84 66 85 63 Z" />
    {/* 脖子 */}
    <rect x="90" y="80" width="28" height="22" />
    {/* 溜肩：肩比士兵窄一圈，肩峰低一点 */}
    <path d="M88 96 C79 101 70 108 62 117 C54 126 48 137 45 150 C43 160 42 172 42 186 L42 260 L158 260 L158 186 C158 172 157 160 155 150 C152 137 146 126 138 117 C130 108 121 101 112 96 Z" />
  </>
)

export function SilhouetteFigure({ variant, className }: SilhouetteFigureProps) {
  const shapes = variant === 'male' ? MALE : FEMALE
  // fill="currentColor"：颜色从外层 color 继承（.beats__figure 给的是纸白），不写死黑色
  return (
    <svg
      className={`silhouette silhouette--${variant}${className ? ` ${className}` : ''}`}
      viewBox="0 0 200 260"
      preserveAspectRatio="xMaxYMax meet"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      role="presentation"
      data-variant={variant}
    >
      {/* 三层错位叠印：边缘不齐，像墨在纸上洇开一道毛边 */}
      <g className="silhouette__grit" opacity="0.55">
        <g transform="translate(1.1 0.9)">{shapes}</g>
        <g transform="translate(-0.9 -0.6)">{shapes}</g>
      </g>
      <g>{shapes}</g>
    </svg>
  )
}
