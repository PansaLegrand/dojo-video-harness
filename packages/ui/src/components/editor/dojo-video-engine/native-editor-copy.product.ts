"use client";

import { useTranslation } from "@/lib/i18n";
import { workspaceCopy } from "./workspace-copy";
import { captionWorkspaceCopy } from "./caption-workspace-copy";
import { nativeEditorAdditionalCopy } from "./native-editor-copy-locales";
import { canvasFormatCopy } from "./canvas-format-copy";
import { editorProductCopy } from "./editor-product-copy";
import { editorContinuationCopy } from "./editor-continuation-copy";
import { editorAuthoringCopy } from "./editor-authoring-copy";

// Reuse the established editor wording in all nine supported locales.
const existing: Record<string, string> = {
  "upload to project": "application.project_outputs.action.upload",
  "uploading video…": "application.project_outputs.action.uploading",
  "saved to project": "application.project_outputs.status.saved",
  "view saved videos": "application.project_outputs.action.view_saved",
  "downloads stay on your device. upload a copy to save it to this project.": "application.project_outputs.local_download_hint",
  "translation": "pages.videoEditor.captionsPanel.translationRole",
  "translate captions": "pages.videoEditor.captionsPanel.translateSubtitles",
  "generate captions": "pages.videoEditor.captionsPanel.generateCaptions",
  "translate to": "pages.videoEditor.captionsPanel.toLanguage",
  "style": "pages.videoEditor.captionsEditor.tabStyle",
  "dynamic": "pages.videoEditor.captionStyle.categories.dynamic.title",
  "source media": "pages.videoEditor.visualizerPanel.sourceLabel",
  "aspect ratio": "pages.videoEditor.timelineSettingsModal.aspectRatio",
  "add text": "pages.videoEditor.textPanel.addText",

  "classic": "pages.videoEditor.captionStyle.templates.classic.name",
  "minimal bar": "pages.videoEditor.captionStyle.templates.minimalBar.name",
  "handwritten": "pages.videoEditor.captionStyle.templates.handwritten.name",
  "retro": "pages.videoEditor.captionStyle.templates.retro.name",
  "cinematic": "pages.videoEditor.captionStyle.templates.cinematic.name",
  "storyteller": "pages.videoEditor.captionStyle.templates.storyteller.name",
  "hustle": "pages.videoEditor.captionStyle.templates.hustle.name",
  "spotlight": "pages.videoEditor.captionStyle.templates.spotlight.name",
  "neon": "pages.videoEditor.captionStyle.templates.neon.name",
  "future": "pages.videoEditor.captionStyle.templates.future.name",
  "terminal": "pages.videoEditor.captionStyle.templates.terminal.name",
  "color shift": "pages.videoEditor.captionStyle.templates.colorShift.name",
  "lyric pulse": "pages.videoEditor.captionStyle.templates.lyricPulse.name",
  "line height": "pages.videoEditor.captionStyle.lineHeight",
  "shadow color": "pages.videoEditor.captionStyle.shadowColor",
  "outline width": "pages.videoEditor.captionStyle.outlineWidth",
  "outline color": "pages.videoEditor.captionStyle.outlineColor",

  "preparing preview…": "pages.videoCompressor.progress.preparingPreview",
  italic: "pages.videoEditor.textPanel.italic",
  "brightness (%)": "pages.videoEditor.videoPanel.brightness",
  video: "pages.videoEditor.sidebar.panels.video",
  text: "pages.videoEditor.sidebar.panels.text",
  audio: "pages.videoEditor.sidebar.panels.audio",
  image: "pages.videoEditor.sidebar.panels.image",
  media: "pages.videoEditor.sidebar.panels.media",
  project: "pages.videoEditor.sidebar.panels.project",
  "music visualizer": "pages.videoEditor.sidebar.panels.musicVisualizer",
  timeline: "pages.videoEditor.visualizerPanel.timelineSource",
  "media library": "pages.videoEditor.visualizerPanel.librarySource",
  undo: "pages.videoEditor.timelineControls.undo",
  redo: "pages.videoEditor.timelineControls.redo",
  pause: "pages.videoEditor.timelineControls.pause",
  play: "pages.videoEditor.timelineControls.play",
  "project name": "pages.videoEditor.projectPanel.title",
  error: "pages.videoEditor.autosaveRecovery.errorTitle",
  save: "pages.videoEditor.renderControls.save",
  "export video": "pages.videoEditor.renderControls.exportTitle",
  cancel: "pages.videoEditor.renderControls.cancel",
  none: "pages.videoEditor.overlayCommon.noneName",
  custom: "pages.videoEditor.overlayCommon.custom",
  padding: "pages.videoEditor.overlayCommon.padding",
  transparent: "pages.videoEditor.overlayCommon.transparent",
  "font size": "pages.videoEditor.textPanel.fontSize",
  volume: "pages.videoEditor.soundPanel.volume",
  mute: "pages.videoEditor.soundPanel.mute",
  unmute: "pages.videoEditor.soundPanel.unmute",
  fit: "pages.videoEditor.imagePanel.fit",
  cover: "pages.videoEditor.imagePanel.cover",
  contain: "pages.videoEditor.imagePanel.contain",
  fill: "pages.videoEditor.imagePanel.fill",
  original: "pages.videoEditor.captionsPanel.originalRole",
  "download srt": "pages.videoEditor.captionsPanel.downloadSrt",
  captions: "pages.videoEditor.captionsEditor.tabCaptions",
  new: "pages.videoEditor.captionsEditor.newCaptionWordOne",
  "text direction": "pages.videoEditor.captionStyle.textDirection",
  ltr: "pages.videoEditor.captionStyle.ltrLabel",
  "left to right": "pages.videoEditor.captionStyle.ltrDescription",
  rtl: "pages.videoEditor.captionStyle.rtlLabel",
  "right to left": "pages.videoEditor.captionStyle.rtlDescription",
  "text color": "pages.videoEditor.captionStyle.textColor",
  "text shadow": "pages.videoEditor.captionStyle.textShadow",
  "text outline": "pages.videoEditor.captionStyle.textOutline",
  static: "pages.videoEditor.captionStyle.categories.static.title",
  karaoke: "pages.videoEditor.captionStyle.templates.karaoke.name",
};

const zh: Record<string, string> = {
    "Browser recovery is unavailable. Keep this tab open until pending changes are saved.": "浏览器恢复存储不可用。请保持此标签页打开，直到待保存的更改完成保存。",
    "Another tab changed this project's recovery data. Keep this tab open until its pending changes are saved.": "另一个标签页更改了此项目的恢复数据。请保持此标签页打开，直到其中待保存的更改完成保存。",
    "Retry browser recovery": "重试浏览器恢复存储",
    "Select layer": "选择图层",
    "Move layer": "移动图层",
    "Resize layer": "调整图层大小",
    "Top edge": "上边缘",
    "Top right corner": "右上角",
    "Right edge": "右边缘",
    "Bottom right corner": "右下角",
    "Bottom edge": "下边缘",
    "Bottom left corner": "左下角",
    "Left edge": "左边缘",
    "Top left corner": "左上角",
    "Use arrow keys to move or resize by one pixel. Hold Shift for ten pixels. Release the arrow keys to save. Escape cancels.": "使用方向键移动或调整大小，每次一像素。按住 Shift 每次调整十像素。松开方向键保存，按 Escape 取消。",
    "Use the inspector to edit animated or transformed dimensions.": "请在检查器中编辑带动画或变换的尺寸。",
    "More layers are available in the inspector.": "可在检查器中选择更多图层。",
  "The selection contains a clip that is no longer available.": "所选内容包含已不可用的片段。",
  "Unlock every selected clip and its dependent tracks before using this batch action.": "使用此批量操作前，请解锁所有选中片段及其关联轨道。",
  "Select source clips without linked captions or graphics for batch timing edits.": "批量调整时间时，请选择源片段，不要同时选择关联字幕或图形。",
  "Unlink the source-bound clip before changing its timing or duplicating it.": "更改时间或复制前，请先取消该片段与源素材的绑定。",
  "Select 500 clips or fewer for a single batch edit.": "一次批量编辑最多选择 500 个片段。",
  "Select 250 clips or fewer to duplicate in one step.": "一次复制最多选择 250 个片段。",
  "Every selected clip must move to an unlocked track of the same type.": "所有选中片段都必须移到已解锁的同类型轨道。",
  "Selected clips": "选中片段",
  "Batch actions affect all selected clips. The inspector edits the primary clip.": "批量操作影响所有选中片段。检查器仅编辑主要片段。",
  "Duplicate selected clips": "复制选中片段",
  "Delete selected clips": "删除选中片段",
  "Select 24 clips or fewer before asking the video agent.": "向视频助手提问前，请将选择范围缩小到 24 个片段以内。",
  "Shift-click selects a range. ⌘/Ctrl-click toggles clips. ⌘/Ctrl+A selects all. Escape clears selection.": "按住 Shift 单击选择连续范围。按住 ⌘/Ctrl 单击切换片段选择状态。⌘/Ctrl+A 全选，Escape 清除选择。",
  "Select one clip to split.": "请选择一个片段进行分割。",
  "You're offline. Your pending edits are kept in this browser.": "当前处于离线状态。待保存的修改会保留在此浏览器中。",
  "Save interrupted. Retry will safely check the same edit.": "保存中断。重试会安全核对此次修改。",
  "Sign in again to save. Your pending edits are kept in this browser.": "请重新登录以保存。待保存的修改会保留在此浏览器中。",
  "You no longer have access to save this project. Your pending edits are kept in this browser.": "你已无权保存此项目。待保存的修改会保留在此浏览器中。",
  "The server rejected a pending edit. Download your draft before discarding unsaved changes.": "服务器拒绝了一项待保存的修改。放弃未保存的修改前，请先下载草稿。",
  "This edit conflicts with a newer change. Choose which version to keep.": "此修改与较新的修改冲突。请选择要保留的版本。",
  "Sign in again": "重新登录",
  "Retrying save…": "正在重试保存…",
  "Retry save": "重试保存",
  "Discard unsaved changes": "放弃未保存的修改",
  "Use Left and Right to move a clip or adjust a focused trim handle by one frame. Hold Shift for one second. Enter or Space selects the clip.": "使用左右方向键移动片段，或将聚焦的裁剪手柄调整一帧。按住 Shift 可调整一秒。按 Enter 或空格键选择片段。",
  "Press Enter to save": "按 Enter 保存",
  "Saving name…": "正在保存名称…",
  "Name saved": "名称已保存",
  "Name not saved": "名称未保存",
  "Retry": "重试",
  "Project name cannot be empty.": "项目名称不能为空。",
  "Project name must be 120 characters or fewer.": "项目名称不能超过 120 个字符。",
  "Enter to send · ⌘/Ctrl+Enter for a new line": "Enter 发送 · ⌘/Ctrl+Enter 换行",
  Delete: "删除",
  "This video is too large for a standard download. Shorten the project or try exporting again in a browser that supports saving directly to a file.": "此视频过大，无法通过普通下载保存。请缩短项目，或使用支持直接保存到文件的浏览器重新导出。",
  "Align right": "右对齐",
  "Align center": "居中对齐",
  "Align left": "左对齐",
  "Bold": "加粗",
  "Text size": "文字大小",
  "Text formatting": "文字格式",
  "Add text": "添加文字",
  "Your video starts here": "从这里开始创作",
  "Import a video, image or audio file to start editing.": "导入视频、图片或音频，开始剪辑。",
  "Your imported media will appear here.": "导入的素材会显示在这里。",
  "Select a video or audio clip to generate captions.": "选择视频或音频片段以生成字幕。",
  "Select a video or audio clip to add a music visualizer.": "选择视频或音频片段以添加音乐可视化。",
  "Resize timeline": "调整时间轴高度",
  "What would you like to create?": "你想创作什么？",
  "Add an opening title": "添加开场标题",
  "Create a motion graphic": "创建动态图形",
  "Help me edit this video": "帮我剪辑这个视频",

  Width: "宽度",
  Height: "高度",
  Background: "背景",
  Rotation: "旋转",
  Opacity: "不透明度",
  Font: "字体",
  Weight: "字重",
  Alignment: "对齐",
  Animation: "动画",
  Filter: "滤镜",
  Speed: "速度",
  Zoom: "缩放",
  Visualizer: "音乐可视化",
  "Export to file": "导出到文件",
  "Video saved to your file": "视频已保存到文件",
  "Reload saved project": "重新加载已保存的项目",
  Project: "项目",
  Projects: "项目列表",
  "Opening project…": "正在打开项目…",
  "Back to projects": "返回项目列表",
  "Video project": "视频项目",
  "Project name": "项目名称",
  Saved: "已保存",
  "Saving…": "正在保存…",
  "Unsaved changes": "有未保存的更改",
  "Save failed": "保存失败",
  "Export video": "导出视频",
  "Import media": "导入素材",
  Media: "素材",
  "Import media files": "导入素材文件",
  "Import subtitles": "导入字幕",
  "Drop video, audio or images here. Up to 250 MB per file.":
    "将视频、音频或图片拖到这里，每个文件最大 250 MB。",
  "Add a caption": "添加字幕",
  "Show media": "显示素材",
  "Hide library": "收起素材库",
  "Show inspector": "显示属性",
  "Hide inspector": "收起属性",
  "Close inspector": "关闭属性",
  "Select a clip to edit it, or add media and text from the library.":
    "选择时间轴上的片段进行编辑，或从素材库添加素材和文字。",
  "Video track": "视频轨道",
  "Audio track": "音频轨道",
  "Video & graphics": "视频与图形",
  "Drag clips to move · drag edges to trim · space to play":
    "拖动片段移动 · 拖动边缘裁剪 · 空格播放",
  Timeline: "时间轴",
  "Timeline zoom": "时间轴缩放",
  "Close gap": "删除空隙",
  "Close the gap at the playhead": "删除播放头所在的空隙",
  "Split at playhead": "在播放头处分割",
  Canvas: "画布",
  "16:9 · Landscape": "16:9 · 横屏",
  "9:16 · Portrait": "9:16 · 竖屏",
  "1:1 · Square": "1:1 · 方形",
  "4:5 · Portrait": "4:5 · 竖屏",
  "Duration (seconds)": "时长（秒）",
  Name: "名称",
  Track: "轨道",
  "Start (s)": "开始（秒）",
  "Duration (s)": "时长（秒）",
  "Position & appearance": "位置与外观",
  "Unlock the track to edit this item.": "解锁轨道后可编辑此片段。",
  Corners: "圆角",
  Padding: "内边距",
  "Background color": "背景色",
  "Filter values": "滤镜参数",
  "Black & white": "黑白",
  Vivid: "鲜艳",
  Muted: "柔和",
  Bright: "明亮",
  Vintage: "复古",
  Custom: "自定义",
  "Fade in & out": "淡入淡出",
  "Slide up": "向上滑入",
  "Pop in": "弹入",
  "Applied animation": "已应用动画",
  "Applied envelope": "已应用音量曲线",
  "Media & sound": "素材与声音",
  "Source offset (s)": "素材起点（秒）",
  "Audio fade": "音频淡入淡出",
  "Add music visualizer": "添加音乐可视化",
  "Speech language": "语音语言",
  "Auto detect": "自动识别",
  "Generate captions · uses credits": "生成字幕 · 消耗积分",
  "Transcribing…": "正在转录…",
  "Text style": "文字样式",
  "System font": "系统字体",
  "Text color": "文字颜色",
  "Clear background": "清除背景",
  "Text outline": "文字描边",
  "Text shadow": "文字阴影",
  "Subtitle settings": "字幕设置",
  "Caption style": "字幕样式",
  Sentence: "整句",
  "One word": "逐字显示",
  "Word highlight": "逐字高亮",
  Highlight: "高亮颜色",
  "Text direction": "文字方向",
  "Left to right": "从左到右",
  "Right to left": "从右到左",
  "Translate to": "翻译为",
  "Add translated track · uses credits": "添加翻译字幕轨道 · 消耗积分",
  "Download SRT": "下载 SRT 字幕",
  "Remove cue": "删除此条字幕",
  "Show more captions": "显示更多字幕",
  Look: "样式",
  "Accent color": "主题色",
  Sensitivity: "灵敏度",
  "Download again": "再次下载",
  "Save to project outputs": "保存到项目成片",
  "Uploading output…": "正在上传成片…",
  "Saved to outputs": "已保存到项目成片",
  "Download draft": "下载草稿",
  "Dismiss error": "关闭错误提示",
  "Dismiss completed export": "关闭导出完成提示",
  "Exporting video": "正在导出视频",
  "Preparing media": "正在准备素材",
  "Finishing video": "正在完成视频",
  "Saving project": "正在保存项目",
  "Keep this tab open while your browser creates the video.":
    "浏览器正在生成视频，请保持此标签页打开。",
  "Media unavailable": "素材不可用",
  "Your text": "输入文字",
  "Your caption": "输入字幕",
  "Music visualizer": "音乐可视化",
};

export function useNativeEditorText() {
  const { t: translate, locale } = useTranslation();
  return (text: string) => {
    if (locale === "en") return text;
    if (editorContinuationCopy[locale]?.[text]) return editorContinuationCopy[locale][text];
    if (editorAuthoringCopy[locale]?.[text]) return editorAuthoringCopy[locale][text];
    if (editorProductCopy[locale]?.[text]) return editorProductCopy[locale][text];
    if (canvasFormatCopy[locale]?.[text]) return canvasFormatCopy[locale][text];
    if (captionWorkspaceCopy[locale]?.[text]) return captionWorkspaceCopy[locale][text];
    if (workspaceCopy[locale]?.[text]) return workspaceCopy[locale]![text]!;
    if (locale === "zh" && zh[text]) return zh[text]!;
    if (nativeEditorAdditionalCopy[locale]?.[text])
      return nativeEditorAdditionalCopy[locale]![text]!;
    const numberedTrack = text.match(/^(Video & graphics|Video|Audio) (\d+)$/);
    if (numberedTrack) {
      const base =
        locale === "zh"
          ? (
              {
                "Video & graphics": "视频与图形",
                Video: "视频",
                Audio: "音频",
              } as Record<string, string>
            )[numberedTrack[1]!]
          : nativeEditorAdditionalCopy[locale]?.[numberedTrack[1]!];
      if (base) return `${base} ${numberedTrack[2]}`;
    }
    const key = existing[text.toLowerCase()];
    if (key) {
      const translated = translate(key);
      if (translated !== key) return translated;
    }
    if (locale === "zh") {
      const cue = text.match(/^Cue (\d+) (start|end) \(s\)$/);
      if (cue)
        return `字幕 ${cue[1]} ${cue[2] === "start" ? "开始" : "结束"}（秒）`;
      if (/^Caption \d+$/.test(text)) return text.replace("Caption", "字幕");
      if (/^\d+ captions$/.test(text))
        return text.replace("captions", "条字幕");
      if (text.startsWith("Uploading "))
        return text.replace("Uploading ", "正在上传 ");
      if (text.startsWith("Video ready ·"))
        return text.replace("Video ready", "视频已导出");
      if (text.startsWith("Transcribing…"))
        return text.replace("Transcribing…", "正在转录…");
    }
    return text;
  };
}
