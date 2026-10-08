#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""金沙文枢·遗韵新生 —— TTS + 口型（Viseme）管线 CLI

用法：
    python3 tts_viseme.py --text "你好，欢迎来到金坛。" --voice zh-CN-XiaoyiNeural --id txxxx

流程（移植自 阳湖非遗作品/yanghu-digital-human/pipeline.py 的
TextProcessor / VisemeMapper / edge-tts 调用，不修改原文件）：
    1. 文本清洗（clean）
    2. edge-tts 合成 mp3 → tts_out/<id>.mp3（24kHz / 48kbps 单声道 CBR），
       同时收集 WordBoundary 词边界时间轴
    3. 拼音（pypinyin）→ 口型映射 + 口型时间线生成
    4. stdout 只输出最后一行 JSON：
       {"audioUrl":"/tts_out/<id>.mp3","visemes":[{"shape","start","end","intensity"}]}

约定：
    - 时间单位为毫秒（ms）
    - shape 枚举：A 大开 / B 中开 / C 微笑 / D 扁唇 / E 圆唇 / F 唇齿 / G 闭唇 / H 舌尖 / X 静音
    - 成功时 stdout 仅此一行（进度与诊断只在失败时写 stderr）
    - 失败：exit 非 0，原因写 stderr；缺依赖时附 pip 安装提示
    - 幂等：同一 --id 重复调用会原子覆盖同名 mp3
"""

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "tts_out"

# edge-tts 固定输出 audio-24khz-48kbitrate-mono-mp3（48kbps CBR）
BYTES_PER_MS = 48_000 / 8 / 1000.0          # == 6.0 字节/毫秒
TICKS_PER_MS = 10_000.0                     # WordBoundary 的 offset/duration 为 100ns 刻度
GAP_FILL_MS = 30.0                          # 词边界之间的静默超过该值时补静息口型 X
MIN_SEGMENT_MS = 0.5                        # 过滤零长片断
SYNTH_TIMEOUT_S = 120.0                     # 合成总超时（秒）

PIP_HINT = (
    "缺少依赖，请先安装：python3 -m pip install -r tts_requirements.txt"
    "（等价于 python3 -m pip install edge-tts pypinyin）"
)

# ------------------------------------------------------------
# 依赖检查（缺依赖 → stderr 提示 + exit 1）
# ------------------------------------------------------------

try:
    import edge_tts
except Exception:                                   # noqa: BLE001
    print(PIP_HINT, file=sys.stderr)
    sys.exit(1)

try:
    from pypinyin import Style as _PyStyle
    from pypinyin import pinyin as _py
except Exception:                                   # noqa: BLE001
    print(PIP_HINT, file=sys.stderr)
    sys.exit(1)


def fail(msg: str) -> "None":
    print(msg, file=sys.stderr, flush=True)
    sys.exit(1)


# ============================================================
# 阶段一：文本预处理（移植 TextProcessor）
# ============================================================

class TextProcessor:
    """文本预处理：清洗（原管线的 SSML <break/> 韵律标记不适用于 edge-tts，故不注入，
    中文标点本身会让 edge-tts 自然停顿）。"""

    _DISALLOWED = re.compile(
        r'[^一-鿿㐀-䶿\w\s'
        r'，。！？、；：""''（）【】《》…—'
        r',.!?;:\'"()\[\]@#$%^&*+=-]'
    )

    @classmethod
    def clean(cls, text: str) -> str:
        """清洗文本，去除多余空白和不可朗读字符（保留中英文、数字和常用标点）"""
        text = re.sub(r"\s+", " ", text).strip()
        return cls._DISALLOWED.sub("", text)


# ============================================================
# 阶段二：语音合成（edge-tts）
# ============================================================

async def _synthesize(text: str, voice: str, mp3_path: Path):
    """edge-tts 合成到 mp3_path（先写临时文件再原子替换）。

    返回 (duration_ms, word_boundaries)；
    word_boundaries: [{text, offset_ms, duration_ms}]
    """
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    boundaries = []
    total_bytes = 0
    tmp_path = mp3_path.with_suffix(".part")

    with open(tmp_path, "wb") as fh:
        async for chunk in communicate.stream():
            ctype = chunk.get("type")
            if ctype == "audio":
                data = chunk.get("data") or b""
                fh.write(data)
                total_bytes += len(data)
            elif ctype == "WordBoundary":
                boundaries.append({
                    "text": chunk.get("text") or "",
                    "offset_ms": float(chunk.get("offset") or 0) / TICKS_PER_MS,
                    "duration_ms": float(chunk.get("duration") or 0) / TICKS_PER_MS,
                })

    if total_bytes <= 0:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise RuntimeError("edge-tts 未返回音频数据（请检查网络连接）")

    os.replace(tmp_path, mp3_path)  # 幂等：同一 id 直接覆盖

    duration_ms = total_bytes / BYTES_PER_MS
    if boundaries:
        last_end = max(b["offset_ms"] + b["duration_ms"] for b in boundaries)
        duration_ms = max(duration_ms, last_end)
    return duration_ms, boundaries


def synthesize(text: str, voice: str, mp3_path: Path):
    """带超时的合成入口，缺依赖时给 pip 提示"""

    async def _run():
        return await asyncio.wait_for(
            _synthesize(text, voice, mp3_path), timeout=SYNTH_TIMEOUT_S
        )

    try:
        return asyncio.run(_run())
    except ImportError:
        fail(PIP_HINT)
    except asyncio.TimeoutError:
        fail(f"TTS 合成超时（>{SYNTH_TIMEOUT_S:.0f}s），请检查网络后重试")
    except Exception as e:                           # noqa: BLE001
        fail(f"TTS 合成失败：{e}")
    return 0.0, []                                   # 不可达，仅为类型完整


# ============================================================
# 阶段三：口型映射（移植 VisemeMapper，增强为首尾分离 + 间隙补静音）
# ============================================================

class VisemeMapper:
    """拼音/字符 → 口型(Viseme) 映射与时间线生成。

    中文拼音 → 口型映射表（简化版，与原管线一致）：
      A类 (大开口): a, ia, ua → mouth open wide
      B类 (中开口): o, e, uo → medium open
      C类 (小开口): i, ü → slight open
      D类 (扁唇): ei, ai, ui → stretched
      E类 (圆唇): u, ou, iu → rounded
      F类 (唇齿): f, v → lip-teeth
      G类 (闭唇): b, p, m → closed lips
      H类 (舌尖): d, t, n, l, g, k, h → tongue-tip
      X类 (静音): 标点、空格 → rest
    """

    PINYIN_TO_VISEME = {
        # 韵母
        'a': 'A', 'ia': 'A', 'ua': 'A',
        'o': 'B', 'uo': 'B', 'e': 'B',
        'i': 'C', 'v': 'C', 'ü': 'C',
        'ai': 'D', 'ei': 'D', 'ui': 'D',
        'u': 'E', 'ou': 'E', 'iu': 'E',
        'ao': 'A', 'iao': 'A',
        'an': 'A', 'ian': 'A', 'uan': 'A',
        'ang': 'A', 'iang': 'A', 'uang': 'A',
        'en': 'B', 'eng': 'B',
        'in': 'C', 'ing': 'C',
        'ong': 'E', 'iong': 'E',
        'un': 'E', 'ün': 'C',
        'ie': 'C', 'ue': 'C', 'er': 'B',
        # 声母（无韵母可用时兜底）
        'b': 'G', 'p': 'G', 'm': 'G',
        'f': 'F',
        'd': 'H', 't': 'H', 'n': 'H', 'l': 'H',
        'g': 'H', 'k': 'H', 'h': 'H',
        'j': 'C', 'q': 'C', 'x': 'C',
        'zh': 'H', 'ch': 'H', 'sh': 'H', 'r': 'H',
        'z': 'H', 'c': 'H', 's': 'H',
        'w': 'E', 'y': 'C',
    }

    # 拼音拼写变体 → 表内写法
    _FINAL_ALIAS = {'iou': 'iu', 'uei': 'ui', 'uen': 'un'}

    # 口型 → 详细描述（与原管线一致，供前端/文档参考）
    VISEME_DESCRIPTIONS = {
        'A': {'name': '大开', 'jaw_open': 1.0, 'lip_round': 0.0, 'mouth_width': 0.5},
        'B': {'name': '中开', 'jaw_open': 0.6, 'lip_round': 0.2, 'mouth_width': 0.5},
        'C': {'name': '微笑', 'jaw_open': 0.3, 'lip_round': 0.0, 'mouth_width': 0.8},
        'D': {'name': '扁唇', 'jaw_open': 0.4, 'lip_round': 0.0, 'mouth_width': 0.9},
        'E': {'name': '圆唇', 'jaw_open': 0.3, 'lip_round': 1.0, 'mouth_width': 0.3},
        'F': {'name': '唇齿', 'jaw_open': 0.2, 'lip_round': 0.0, 'mouth_width': 0.5},
        'G': {'name': '闭唇', 'jaw_open': 0.0, 'lip_round': 0.0, 'mouth_width': 0.5},
        'H': {'name': '舌尖', 'jaw_open': 0.2, 'lip_round': 0.0, 'mouth_width': 0.6},
        'X': {'name': '静音', 'jaw_open': 0.05, 'lip_round': 0.0, 'mouth_width': 0.2},
    }

    # ASCII 字母/数字的口型（与声母表口径一致；标点与空白走 X）
    ASCII_VISEME = {
        'a': 'A', 'e': 'B', 'i': 'C', 'o': 'B', 'u': 'E', 'y': 'C', 'w': 'E',
        'b': 'G', 'p': 'G', 'm': 'G',
        'f': 'F',
        'd': 'H', 't': 'H', 'n': 'H', 'l': 'H', 'g': 'H', 'k': 'H', 'h': 'H',
        'z': 'H', 'c': 'H', 's': 'H', 'r': 'H',
        'j': 'C', 'q': 'C', 'x': 'C',
    }

    _char_cache = {}

    # ---------- 单字映射 ----------

    @classmethod
    def _is_cjk(cls, ch: str) -> bool:
        o = ord(ch)
        return (0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF
                or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x3134F)

    @classmethod
    def _norm_final(cls, final: str) -> str:
        f = re.sub(r"\d", "", (final or "")).lower()
        if not f:
            return ""
        if f == "v":           # 单韵母 ü（如 绿 lv）→ 表内 'v'
            return "v"
        if f == "vn":          # ün
            return "ün"
        if f.startswith("v"):  # van/ve → uan/ue（ü 介音韵母）
            f = "u" + f[1:]
        return cls._FINAL_ALIAS.get(f, f)

    @classmethod
    def _cjk_viseme(cls, ch: str) -> str:
        try:
            ini = _py(ch, style=_PyStyle.INITIALS, heteronym=False)
            fin = _py(ch, style=_PyStyle.FINALS_TONE3, heteronym=False)
            initial = (ini[0][0] if ini and ini[0] else "").lower()
            final = cls._norm_final(fin[0][0] if fin and fin[0] else "")

            # 韵母决定口型，优先匹配；生僻韵母退化为前缀匹配
            if final:
                if final in cls.PINYIN_TO_VISEME:
                    return cls.PINYIN_TO_VISEME[final]
                for length in (3, 2):
                    if len(final) >= length and final[:length] in cls.PINYIN_TO_VISEME:
                        return cls.PINYIN_TO_VISEME[final[:length]]
            if initial and initial in cls.PINYIN_TO_VISEME:
                return cls.PINYIN_TO_VISEME[initial]
            if final[:1] in cls.PINYIN_TO_VISEME:
                return cls.PINYIN_TO_VISEME[final[:1]]
            return "B"
        except Exception:                            # noqa: BLE001
            return cls._heuristic_viseme(ch)

    @classmethod
    def _heuristic_viseme(cls, ch: str) -> str:
        """pypinyin 查询失败时的兜底：按 Unicode 区段粗略分配（与原管线一致）"""
        code = ord(ch)
        if 0x4E00 <= code <= 0x9FFF:
            return ["A", "B", "C", "D", "E", "H"][code % 6]
        return "X"

    @classmethod
    def char_to_viseme(cls, ch: str) -> str:
        """单个字符 → 口型"""
        if not ch or ch.isspace():
            return "X"
        cached = cls._char_cache.get(ch)
        if cached:
            return cached
        shape = cls._classify(ch)
        if len(cls._char_cache) < 20000:
            cls._char_cache[ch] = shape
        return shape

    @classmethod
    def _classify(cls, ch: str) -> str:
        cat = unicodedata.category(ch)
        if cat[0] in ("P", "Z", "S", "C"):           # 标点 / 分隔 / 符号 / 控制 → 静音
            return "X"
        if "a" <= ch.lower() <= "z":
            return cls.ASCII_VISEME.get(ch.lower(), "X")
        if ch.isdigit():
            return "B"
        if cls._is_cjk(ch):
            return cls._cjk_viseme(ch)
        return "X"

    # ---------- 时间线 ----------

    @classmethod
    def generate_viseme_timeline(cls, text, total_duration_ms, word_boundaries=None):
        """生成口型时间线（list[dict]，毫秒）。

        有 word_boundaries（来自 edge-tts）时按词边界精确对齐；
        否则按非空白字符均分总时长。
        之后：静默间隙补 X（闭合静息）→ 与音频首尾对齐 → 合并相邻同口型。
        """
        total = max(float(total_duration_ms or 0.0), MIN_SEGMENT_MS)
        spans = []

        if word_boundaries:
            for wb in word_boundaries:
                word_text = str(wb.get("text") or "")
                offset = float(wb.get("offset_ms") or 0.0)
                duration = float(wb.get("duration_ms") or 0.0)
                chars = [c for c in word_text if not c.isspace()]
                if not chars or duration <= 0:
                    continue
                char_dur = duration / len(chars)
                for j, ch in enumerate(chars):
                    spans.append((offset + j * char_dur,
                                  offset + (j + 1) * char_dur,
                                  cls.char_to_viseme(ch)))

        if not spans:
            # 无边界信息时，按非空白字符均分
            chars = [c for c in str(text) if not c.isspace()]
            if not chars:
                return [{"shape": "X", "start": 0.0, "end": round(total, 1),
                         "intensity": 1.0}]
            char_dur = total / len(chars)
            for j, ch in enumerate(chars):
                spans.append((j * char_dur, (j + 1) * char_dur,
                              cls.char_to_viseme(ch)))

        spans.sort(key=lambda s: s[0])

        # 连续化：裁剪越界、间隙补 X，时间轴覆盖 [0, total]
        timeline = []
        cursor = 0.0
        for start, end, shape in spans:
            if start >= total:
                break
            end = min(end, total)
            if start - cursor >= GAP_FILL_MS:        # 停顿 → 闭嘴静息
                timeline.append((cursor, start, "X"))
                cursor = start
            if end - cursor >= MIN_SEGMENT_MS:       # 重叠部分裁到 cursor
                timeline.append((cursor, end, shape))
                cursor = end
        if total - cursor >= MIN_SEGMENT_MS:
            timeline.append((cursor, total, "X"))

        return cls._merge_adjacent(timeline)

    @classmethod
    def _merge_adjacent(cls, timeline):
        """合并相邻的相同口型，输出 JSON 结构"""
        merged = []
        for start, end, shape in timeline:
            if merged and merged[-1]["shape"] == shape and start - merged[-1]["end"] < 1.0:
                merged[-1]["end"] = round(end, 1)
            else:
                merged.append({"shape": shape, "start": round(start, 1),
                               "end": round(end, 1), "intensity": 1.0})
        # 收尾防误差：保证末尾贴住总时长
        if merged:
            merged[-1]["end"] = round(max(merged[-1]["end"], merged[-1]["start"]), 1)
        return merged


# ============================================================
# 入口
# ============================================================

def main() -> "None":
    parser = argparse.ArgumentParser(
        description="金坛数字文旅平台：edge-tts 语音合成 + 口型时间线",
    )
    parser.add_argument("--text", required=True, help="要合成朗读的文本")
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural",
                        help="edge-tts 语音名，默认 zh-CN-XiaoyiNeural")
    parser.add_argument("--id", default=None,
                        help="输出 id（tts_out/<id>.mp3），缺省时随机生成")

    # --text 的值若以 '-' 开头（如 "-100"），argparse 会误判为选项，改写成 --text= 形式
    argv = sys.argv[1:]
    for i, tok in enumerate(argv):
        if tok == "--text" and i + 1 < len(argv) and argv[i + 1].startswith("-"):
            argv[i] = "--text=" + argv[i + 1]
            del argv[i + 1]
            break

    args = parser.parse_args(argv)

    text = TextProcessor.clean(args.text)
    if not text:
        fail("文本为空或清洗后为空，无法合成")

    tid = re.sub(r"[^A-Za-z0-9_-]", "", str(args.id or ""))
    if not tid:
        tid = "t" + os.urandom(4).hex()

    try:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        fail(f"无法创建输出目录 {OUT_DIR}：{e}")

    mp3_path = OUT_DIR / f"{tid}.mp3"
    duration_ms, boundaries = synthesize(text, args.voice, mp3_path)

    if not mp3_path.is_file() or mp3_path.stat().st_size <= 0:
        fail("音频文件未生成或为空")

    visemes = VisemeMapper.generate_viseme_timeline(
        text=text, total_duration_ms=duration_ms, word_boundaries=boundaries
    )

    result = {"audioUrl": f"/tts_out/{tid}.mp3", "visemes": visemes}
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)  # 成功路径：不跑解释器收尾，避免任何迟到的 stderr 噪声混入服务端解析


if __name__ == "__main__":
    main()
