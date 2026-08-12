#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-generic.py — 从个人版 (agent-dashboard, v0.2.7) 派生「通用版」插件。

通用版 = 个人版去掉「机会点」功能；manifest id 保持 agent-dashboard、name 统一为 "Dashboard"（与个人版一致，靠 root/ 与 generic/ 不同输出文件夹区分，不单独改 id）。
本脚本是唯一的派生入口：以后维护通用版只改这里，不要再维护一套旧架构分支。

跨系统可用：所有路径基于脚本自身位置，不写死任何盘符/绝对路径。
需在“有 node_modules 的工作区”旁运行（本脚本会借用其 rollup + typescript 打包）。

用法：
    python3 scripts/build-generic.py
"""
import os
import re
import sys
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent            # .../agent-dashboard/scripts
ROOT = HERE.parent                                 # .../agent-dashboard  (个人版真身)
SHARE = ROOT.parent                               # .../Share
GEN = ROOT / 'generic'                            # 通用版输出子目录（与真身同仓）
WS = ROOT.parent.parent / 'My Dashboard'          # 鸿蒙本地工作区（可选，提供 node_modules）
BUILD = ROOT / '_build_tmp'                       # 临时构建目录（真身仓内）

EXCLUDE_DIRS = {'.git', '.workbuddy', 'node_modules'}
GENERIC_NAME = 'Dashboard'


def log(msg):
    print(f'[build-generic] {msg}')


def find_node():
    for cand in (shutil.which('node'), '/data/service/hnp/bin/node'):
        if cand and Path(cand).exists():
            return cand
    sys.exit('找不到 node，无法打包')


def find_rollup():
    for base in (ROOT, WS):
        p = base / 'node_modules' / 'rollup' / 'dist' / 'bin' / 'rollup'
        if p.exists():
            return p
        p2 = base / 'node_modules' / '.bin' / 'rollup'
        if p2.exists():
            return p2
    sys.exit(f'找不到 rollup（已探测 {ROOT}/node_modules 与 {WS}/node_modules）')


def copy_source(src, dst):
    def ignore(d, names):
        return [n for n in names if n in EXCLUDE_DIRS]
    # 鸿蒙环境 shutil.rmtree 删除会崩（只能写不能删），故用 dirs_exist_ok 覆盖而非先删。
    shutil.copytree(src, dst, ignore=ignore, dirs_exist_ok=True)
    log(f'已复制源码 {src.name} -> {dst}')


def delete_opportunity_files(root):
    # 跨系统安全：不物理删除（部分环境 unlink 会崩），改为重写为空模块
    EMPTY = "// 通用版已移除机会点功能\nexport {};\n"
    for dp, dn, fn in os.walk(root):
        for f in fn:
            low = f.lower()
            if 'opportunity' in low or low == 'opportunitymodal.ts' or 'opportunityboard' in low:
                p = Path(dp) / f
                p.write_text(EMPTY, encoding='utf-8')
                log(f'清空机会点整文件: {p.relative_to(root)}')


def strip_constants(txt):
    # 删: // 机会点（第三页）整块 (opAll / opRoadmap)
    old = "\n\t// 机会点（第三页）\n\topAll: '全部机会点',\n\topRoadmap: '★ 转路标',\n"
    return txt.replace(old, "\n")


def strip_icons(txt):
    lines = [l for l in txt.split('\n') if not l.strip().startswith('export const ICON_opportunity')]
    return '\n'.join(lines)


def strip_settings(txt):
    txt = txt.replace(
        "\tpoGanttStatusFilter?: string[];\n\topportunityFile: string;\n\tcurrentOppView: string;\n",
        "\tpoGanttStatusFilter?: string[];\n",
    )
    txt = txt.replace(
        "\tpoGanttStatusFilter: [],\n\topportunityFile: 'Projects/机会点管理.md',\n\tcurrentOppView: 'kanban',\n",
        "\tpoGanttStatusFilter: [],\n",
    )
    # 删「机会点」设置 UI 整段（/* ---- 机会点 ---- */ ... );\n）
    txt = re.sub(r"\t/\* ---- 机会点 ---- \*/.*?\t\t\);\n", "", txt, flags=re.S)
    return txt


def strip_project_board(txt):
    # 类型 union 去掉 'opportunity'
    return txt.replace(" | 'opportunity'", "")


def strip_dashboard_view(txt):
    # 1) 整行删除
    drop = (
        "import { OpportunityBoard } from './OpportunityBoard';",
        "private oppBoard: OpportunityBoard;",
        "this.oppBoard = new OpportunityBoard(this);",
        "action: 'opportunity'",
        "if (it.action === 'opportunity') void this.oppBoard.show();",
    )
    out = [l for l in txt.split('\n') if not any(d in l.strip() for d in drop)]
    txt = '\n'.join(out)

    # 2) ICON import 去掉 ICON_opportunity
    txt = txt.replace(
        "\tICON_allProjects, ICON_opportunity, injectSvg,\n",
        "\tICON_allProjects, injectSvg,\n",
    )

    # 3) currentPage 类型去掉 'opportunity'
    txt = txt.replace(" | 'opportunity'", "")

    # 4) 删除所有“如果是机会点页”的 else-if 分支（缩进无关，兼容不同层级），保留 } else {
    txt = re.sub(
        r"\} else if \(this\.currentPage === 'opportunity'\) \{.*?\n\t*\}\s*else \{",
        "} else {",
        txt,
        flags=re.S,
    )
    # 5) 清理注释里的机会点字样
    txt = txt.replace(
        "// Which top-level page is currently shown (home / project overview / opportunity board)",
        "// Which top-level page is currently shown (home / project overview)",
    )
    txt = txt.replace(
        "// 必须在渲染前重校验，否则会把主页卡片渲染进机会点/项目页面。",
        "// 必须在渲染前重校验，否则会把主页卡片渲染进项目页面。",
    )
    txt = txt.replace(
        "/** Refresh whichever board is active (home cards, project overview, or opportunity board) */",
        "/** Refresh whichever board is active (home cards or project overview) */",
    )
    return txt


def process_src(root):
    mapping = {
        'constants.ts': strip_constants,
        'icons.ts': strip_icons,
        'settings.ts': strip_settings,
        'views/ProjectBoard.ts': strip_project_board,
        'views/DashboardView.ts': strip_dashboard_view,
    }
    for rel, fn in mapping.items():
        p = root / rel
        if not p.exists():
            continue
        txt = p.read_text(encoding='utf-8')
        new = fn(txt)
        if new != txt:
            p.write_text(new, encoding='utf-8')
            log(f'已剥离机会点引用: {rel}')


def set_manifest(root):
    p = root / 'manifest.json'
    data = json.loads(p.read_text(encoding='utf-8'))
    data['name'] = GENERIC_NAME
    # 版本号沿用个人版 0.2.7（同期派生）
    p.write_text(json.dumps(data, indent='\t', ensure_ascii=False) + '\n', encoding='utf-8')
    log(f"manifest.name -> {GENERIC_NAME} (version {data.get('version')})")


def build(root, node, rollup):
    """返回 True 表示已生成 main.js；返回 False 表示跳过（当前环境无法打包）。"""
    log(f'用 rollup 打包 {root}/src -> main.js ...')
    try:
        r = subprocess.run([node, str(rollup), '-c', 'rollup.config.mjs'], cwd=str(root), timeout=180)
    except Exception as e:
        log(f'⚠️ 打包跳过：当前环境无法运行 node（{e}）。源码已同步，请在 Windows 运行本脚本生成 main.js。')
        return False
    if r.returncode != 0:
        log('⚠️ 打包跳过：rollup 返回非零。请在 Windows 运行本脚本生成 main.js。')
        return False
    if not (root / 'main.js').exists():
        log('⚠️ 打包跳过：未生成 main.js。请在 Windows 运行本脚本生成 main.js。')
        return False
    log('打包成功 -> main.js')
    return True


def sync_to_generic(root):
    # 复制构建产物到通用版目录（覆盖同名旧文件，保留设计工具等独有文件）
    if not GEN.exists():
        GEN.mkdir(parents=True)
    for item in root.iterdir():
        if item.name in EXCLUDE_DIRS:
            continue
        dst = GEN / item.name
        if item.is_dir():
            # 鸿蒙 rmtree 删文件会崩（只能写不能删），用 dirs_exist_ok 覆盖而非先删
            shutil.copytree(item, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dst)
    log(f'已同步到通用版目录: {GEN}')


def main():
    node = find_node()
    rollup = find_rollup()
    log(f'个人版真身: {ROOT}')
    log(f'通用版输出: {GEN}')

    # 1) 复制 + 剥离
    copy_source(ROOT, BUILD)
    delete_opportunity_files(BUILD / 'src')
    process_src(BUILD / 'src')
    set_manifest(BUILD)

    # 2) 打包（若当前环境 node 不可用则跳过，仅同步源码）
    if not build(BUILD, node, rollup):
        log('注意：当前环境未生成 main.js，通用版插件需在 Windows 端完成打包。')

    # 3) 同步到通用版目录（generic/）
    sync_to_generic(BUILD)

    # 4) 清理临时目录（鸿蒙删文件会崩，尽力而为，失败则保留 _build_tmp 不影响产物）
    log('完成。通用版已派生自 v0.2.7（不含机会点）。')
    try:
        shutil.rmtree(BUILD, ignore_errors=True)
    except Exception:
        pass


if __name__ == '__main__':
    main()
