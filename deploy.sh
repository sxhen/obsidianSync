#!/bin/bash

# ============================================================
# Obsidian LAN Sync - 一键构建部署脚本
# 首次运行会自动将仓库路径写入下方 VAULT_PATH 变量
# ============================================================

# >>> 自动写入区域，首次运行后会被替换 <<<
VAULT_PATH="__NOT_SET__"

PLUGIN_ID="lan-sync"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------- 首次运行：交互写入仓库路径 ----------
if [ "$VAULT_PATH" = "__NOT_SET__" ]; then
    read -rp "请输入 Obsidian 仓库路径（例如 /home/user/my-vault）: " input_path

    # 去掉末尾斜杠
    input_path="${input_path%/}"

    if [ ! -d "$input_path/.obsidian" ]; then
        echo "错误: 未找到 $input_path/.obsidian 目录，请确认路径正确"
        exit 1
    fi

    # 将路径写回脚本自身
    sed -i "s|VAULT_PATH=\"__NOT_SET__\"|VAULT_PATH=\"$input_path\"|" "$0"
    echo "✓ 仓库路径已保存到脚本: $input_path"
    VAULT_PATH="$input_path"
fi

TARGET_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

echo ""
echo "========== 构建 =========="
cd "$SCRIPT_DIR" || exit 1
npm run build
if [ $? -ne 0 ]; then
    echo "错误: 构建失败"
    exit 1
fi

echo ""
echo "========== 部署 =========="
mkdir -p "$TARGET_DIR"

cp -v main.js       "$TARGET_DIR/"
cp -v manifest.json "$TARGET_DIR/"
cp -v styles.css    "$TARGET_DIR/" 2>/dev/null

echo ""
echo "✓ 部署完成 -> $TARGET_DIR"
