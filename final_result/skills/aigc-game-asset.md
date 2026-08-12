# Skill：AIGC 游戏素材生产

## 适用场景

需要为 2D 游戏项目批量生成视觉资产，包括：
- 角色/载具图（透明背景 PNG，多配色）
- 特效序列帧图集（Spritesheet）
- 爆炸、命中等动效帧图

适用项目类型：Phaser 3、PixiJS、Unity 等支持 PNG/Spritesheet 的游戏引擎。

---

## 输入

| 参数 | 说明 | 示例 |
|---|---|---|
| 资产描述 | 角色名称、风格、视角 | "俯视角坦克，金属质感，炮管朝右" |
| 配色数量 | 需要几种颜色变体 | 4（蓝 / 红 / 绿 / 黄） |
| 尺寸要求 | 单帧像素尺寸 | 256×256 px |
| 背景要求 | 透明或纯色 | 透明背景（PNG RGBA）|
| 帧数（序列帧） | 行 × 列 | 4×4（共 16 帧）|

---

## 输出

- 透明背景 PNG（单张，多配色变体）
- 或 Spritesheet PNG（N×M 帧图集，命名规范 `name_NxM.png`）

---

## 操作步骤

### Step 1：生成原始图片

使用 AIGC 工具（Kling AI / design-ai）生成：

**Prompt 模板（坦克）**：
```
Top-down view military tank, [COLOR] color, metallic surface, clean vector art style,
gun barrel pointing right, white/transparent background, game asset, 256x256px
```

将 `[COLOR]` 替换为 `blue` / `red` / `green` / `yellow`，分别生成 4 张图。

**Prompt 模板（爆炸序列帧）**：
```
16-frame explosion sprite sheet, 4 rows × 4 columns, orange fire ball,
each frame 256×256px, transparent background, game FX style,
frame 1=spark, frame 8=peak, frame 16=smoke dissipate
```

### Step 2：检查背景与格式

下载后确认：
- 背景是否透明（PNG RGBA 模式）
- 如为纯色背景，进入 Step 3 去背

```bash
python3 -c "
from PIL import Image
img = Image.open('asset.png')
print('Mode:', img.mode, 'Size:', img.size)
"
```

### Step 3：去除纯色背景（如需）

使用 flood-fill 从边缘向内消除背景色：

```python
from PIL import Image
from collections import deque

def remove_bg(src_path: str, dst_path: str, tolerance: int = 30) -> None:
    img = Image.open(src_path).convert("RGBA")
    px = img.load()
    w, h = img.size

    # 用边缘像素推断背景色
    bg = None
    for x in range(w):
        r, g, b, _ = px[x, 0]
        if r > 30:
            bg = (r, g, b)
            break

    def is_bg(r, g, b):
        if bg:
            return max(abs(int(r)-bg[0]), abs(int(g)-bg[1]), abs(int(b)-bg[2])) <= tolerance
        diff = max(abs(int(r)-int(g)), abs(int(g)-int(b)), abs(int(r)-int(b)))
        return diff <= 20 and 60 <= int(r) <= 210

    visited = [[False]*w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.append((0, x)); q.append((h-1, x))
    for y in range(h):
        q.append((y, 0)); q.append((y, w-1))

    while q:
        y, x = q.popleft()
        if not (0 <= y < h and 0 <= x < w) or visited[y][x]:
            continue
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b):
            continue
        visited[y][x] = True
        px[x, y] = (0, 0, 0, 0)
        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
            q.append((y+dy, x+dx))

    img.save(dst_path)
    print(f"保存至 {dst_path}")

# 使用示例
remove_bg("tank_blue_raw.png", "tank_blue.png", tolerance=30)
```

### Step 4：验证输出

```python
from PIL import Image
img = Image.open("asset.png").convert("RGBA")
px = img.load()
w, h = img.size
transparent = sum(1 for y in range(h) for x in range(w) if px[x,y][3] == 0)
print(f"透明像素比例: {transparent*100//(w*h)}%")
# 预期：背景占比 60%~85%，主体保留完整
```

### Step 5：命名规范

| 资产类型 | 命名规范 | 示例 |
|---|---|---|
| 单张角色图 | `{name}-{index}.png` | `tank-0.png` |
| 序列帧图集 | `{name}_{rows}x{cols}.png` | `boom_4x4.png` |
| Lottie 动画 | 目录 `{name}/data.json` + `images/` | `win/data.json` |

---

## 使用约束

1. **尺寸一致性**：同一动画的所有帧必须等宽等高，否则切帧偏移
2. **透明背景**：输出必须是 RGBA PNG，RGB 图在游戏引擎中会显示白色/黑色背景
3. **背景色单一**：flood-fill 方法仅适用于纯色背景；渐变背景需改用抠图工具
4. **容差参数**：`tolerance=30` 适合灰色背景；深色或彩色背景需调整
5. **版权**：使用商用 AIGC 工具时确认生成内容的授权条款

---

## 验证方法

1. 在 Photoshop / GIMP 打开，切换棋盘格背景，确认透明区域正确
2. 在浏览器中创建 Canvas 测试：

```html
<canvas id="c" width="256" height="256"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, 256, 256); // 深色背景
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0);
  img.src = 'asset.png';
</script>
```

深色背景上无白边 / 灰边 = 透明背景正确。

3. 对于序列帧，在 Phaser 中播放一遍确认无残影、无错帧

---

## 使用示例

**目标**：为 KTank 生成 4 种颜色坦克图

```bash
# 1. 使用 Kling AI 生成 4 张坦克图（参考 Step 1 Prompt）
# 2. 下载为 tank_blue.png, tank_red.png, tank_green.png, tank_yellow.png

# 3. 批量去背景
python3 << 'EOF'
from remove_bg import remove_bg  # 使用上方 Step 3 函数
for color in ['blue', 'red', 'green', 'yellow']:
    remove_bg(f'tank_{color}_raw.png', f'tank-{["blue","red","green","yellow"].index(color)}.png')
EOF

# 4. 放入工程目录
mv tank-*.png apps/client/src/assets/tanks/
```

**结果**：4 张透明背景 PNG，可直接被 Phaser `this.load.image()` 加载。
