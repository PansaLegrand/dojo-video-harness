const locales = ["zh", "es", "fr", "de", "ja", "ko", "pt", "it"] as const;
const rows: Record<string, readonly string[]> = {
  "There is not enough browser storage for this file. Free space and retry importing it.": [
    "浏览器存储空间不足，请释放空间后重试导入。",
    "No hay suficiente espacio en el navegador. Libera espacio y vuelve a importar el archivo.",
    "L’espace de stockage du navigateur est insuffisant. Libérez de l’espace et réessayez l’importation.",
    "Der Browserspeicher reicht nicht aus. Gib Speicher frei und importiere die Datei erneut.",
    "ブラウザーの保存容量が不足しています。空き容量を増やして読み込みを再試行してください。",
    "브라우저 저장 공간이 부족합니다. 공간을 확보한 후 다시 가져오세요.",
    "Não há espaço suficiente no navegador. Libere espaço e tente importar novamente.",
    "Lo spazio nel browser è insufficiente. Libera spazio e riprova a importare il file."
  ],
  "Import queue": [
    "导入队列",
    "Cola de importación",
    "File d’importation",
    "Importwarteschlange",
    "読み込みキュー",
    "가져오기 대기열",
    "Fila de importação",
    "Coda di importazione"
  ],
  "Waiting to import": [
    "等待导入",
    "Pendiente de importar",
    "En attente d’importation",
    "Wartet auf Import",
    "読み込み待ち",
    "가져오기 대기 중",
    "Aguardando importação",
    "In attesa di importazione"
  ],
  "Imported": [
    "已导入",
    "Importado",
    "Importé",
    "Importiert",
    "読み込み済み",
    "가져옴",
    "Importado",
    "Importato"
  ],
  "Importing": [
    "正在导入",
    "Importando",
    "Importation",
    "Wird importiert",
    "読み込み中",
    "가져오는 중",
    "Importando",
    "Importazione"
  ],
  "Duplicate file skipped": [
    "已跳过重复文件",
    "Archivo duplicado omitido",
    "Doublon ignoré",
    "Doppelte Datei übersprungen",
    "重複ファイルをスキップ",
    "중복 파일 건너뜀",
    "Arquivo duplicado ignorado",
    "File duplicato ignorato"
  ],
  "Import paused": [
    "导入已暂停",
    "Importación pausada",
    "Importation en pause",
    "Import pausiert",
    "読み込み一時停止",
    "가져오기 일시 중지",
    "Importação pausada",
    "Importazione in pausa"
  ],
  "Cancelled": [
    "已取消",
    "Cancelado",
    "Annulé",
    "Abgebrochen",
    "キャンセル済み",
    "취소됨",
    "Cancelado",
    "Annullato"
  ],
  "Skipped": [
    "已跳过",
    "Omitido",
    "Ignoré",
    "Übersprungen",
    "スキップ済み",
    "건너뜀",
    "Ignorado",
    "Ignorato"
  ],
  "Choose original files": [
    "选择原始文件",
    "Elegir archivos originales",
    "Choisir les fichiers originaux",
    "Originaldateien auswählen",
    "元のファイルを選択",
    "원본 파일 선택",
    "Escolher arquivos originais",
    "Scegli file originali"
  ],
  "Continue import": [
    "继续导入",
    "Continuar importación",
    "Continuer l’importation",
    "Import fortsetzen",
    "読み込みを続行",
    "가져오기 계속",
    "Continuar importação",
    "Continua importazione"
  ],
  "Skip this file": [
    "跳过此文件",
    "Omitir este archivo",
    "Ignorer ce fichier",
    "Diese Datei überspringen",
    "このファイルをスキップ",
    "이 파일 건너뛰기",
    "Ignorar este arquivo",
    "Salta questo file"
  ],
  "Dismiss import queue": [
    "关闭导入队列",
    "Cerrar cola de importación",
    "Fermer la file d’importation",
    "Importwarteschlange schließen",
    "読み込みキューを閉じる",
    "가져오기 대기열 닫기",
    "Fechar fila de importação",
    "Chiudi coda di importazione"
  ],
  "Media usage": [
    "素材使用情况",
    "Uso de medios",
    "Utilisation des médias",
    "Mediennutzung",
    "メディアの使用状況",
    "미디어 사용 상태",
    "Uso de mídia",
    "Uso dei contenuti"
  ],
  "All sources": [
    "全部源素材",
    "Todas las fuentes",
    "Toutes les sources",
    "Alle Quellen",
    "すべてのソース",
    "모든 소스",
    "Todas as fontes",
    "Tutte le sorgenti"
  ],
  "Used in timeline": [
    "已用于时间线",
    "En la línea de tiempo",
    "Utilisé dans le montage",
    "In der Timeline verwendet",
    "タイムラインで使用中",
    "타임라인에서 사용 중",
    "Na linha do tempo",
    "Usati nella timeline"
  ],
  "Unused sources": [
    "未使用的源素材",
    "Fuentes sin usar",
    "Sources inutilisées",
    "Unbenutzte Quellen",
    "未使用のソース",
    "사용하지 않은 소스",
    "Fontes não utilizadas",
    "Sorgenti inutilizzate"
  ],
  "Select media": [
    "选择素材",
    "Seleccionar medio",
    "Sélectionner le média",
    "Medium auswählen",
    "メディアを選択",
    "미디어 선택",
    "Selecionar mídia",
    "Seleziona contenuto"
  ],
  "Selected media order": [
    "已选素材顺序",
    "Orden de medios seleccionados",
    "Ordre des médias sélectionnés",
    "Reihenfolge ausgewählter Medien",
    "選択メディアの順序",
    "선택한 미디어 순서",
    "Ordem da mídia selecionada",
    "Ordine dei contenuti selezionati"
  ],
  "Add selected in order": [
    "按顺序添加所选素材",
    "Añadir selección en orden",
    "Ajouter la sélection dans l’ordre",
    "Auswahl der Reihe nach hinzufügen",
    "選択順に追加",
    "선택한 순서대로 추가",
    "Adicionar seleção em ordem",
    "Aggiungi selezione in ordine"
  ],
  "Clear media selection": [
    "清除素材选择",
    "Borrar selección de medios",
    "Effacer la sélection des médias",
    "Medienauswahl aufheben",
    "メディア選択を解除",
    "미디어 선택 해제",
    "Limpar seleção de mídia",
    "Deseleziona contenuti"
  ],
  "Move selected media earlier": [
    "前移所选素材",
    "Mover medio antes",
    "Avancer le média sélectionné",
    "Ausgewähltes Medium vorziehen",
    "選択メディアを前へ",
    "선택한 미디어 앞으로 이동",
    "Mover mídia selecionada para antes",
    "Sposta il contenuto prima"
  ],
  "Move selected media later": [
    "后移所选素材",
    "Mover medio después",
    "Reculer le média sélectionné",
    "Ausgewähltes Medium nach hinten",
    "選択メディアを後ろへ",
    "선택한 미디어 뒤로 이동",
    "Mover mídia selecionada para depois",
    "Sposta il contenuto dopo"
  ],
  "Import progress could not be saved. Keep this tab open to finish this batch.": [
    "无法保存导入进度。请保持此标签页打开以完成这批导入。",
    "No se pudo guardar el progreso. Mantén esta pestaña abierta para completar el lote.",
    "La progression n’a pas pu être enregistrée. Gardez cet onglet ouvert pour terminer ce lot.",
    "Der Importfortschritt konnte nicht gespeichert werden. Halte diesen Tab bis zum Ende offen.",
    "読み込み状況を保存できません。このタブを開いたまま完了してください。",
    "가져오기 진행 상황을 저장하지 못했습니다. 완료할 때까지 이 탭을 열어 두세요.",
    "Não foi possível salvar o progresso. Mantenha esta aba aberta até concluir o lote.",
    "Impossibile salvare l’avanzamento. Tieni aperta questa scheda per completare il lotto."
  ],
  "Some selected media is unavailable. Relink it before adding the selection.": [
    "部分所选素材不可用，请先重新关联。",
    "Algunos medios no están disponibles. Vincúlalos de nuevo antes de añadirlos.",
    "Certains médias sélectionnés sont indisponibles. Rétablissez leurs liens avant de les ajouter.",
    "Einige ausgewählte Medien fehlen. Verknüpfe sie vor dem Hinzufügen erneut.",
    "選択したメディアの一部がありません。再リンクしてから追加してください。",
    "일부 선택한 미디어를 사용할 수 없습니다. 다시 연결한 후 추가하세요.",
    "Algumas mídias selecionadas estão indisponíveis. Vincule-as novamente antes de adicionar.",
    "Alcuni contenuti selezionati non sono disponibili. Ricollegali prima di aggiungerli."
  ],
  "Choose 5,000 files or fewer for one import batch.": [
    "每批请选择不超过5,000个文件。",
    "Elige como máximo 5.000 archivos por lote.",
    "Choisissez au maximum 5 000 fichiers par lot.",
    "Wähle höchstens 5.000 Dateien pro Import.",
    "一度に選択できるファイルは5,000件までです。",
    "한 번에 5,000개 이하의 파일을 선택하세요.",
    "Escolha no máximo 5.000 arquivos por lote.",
    "Scegli al massimo 5.000 file per lotto."
  ],
  "The file could not be imported.": [
    "无法导入此文件。",
    "No se pudo importar el archivo.",
    "Le fichier n’a pas pu être importé.",
    "Die Datei konnte nicht importiert werden.",
    "ファイルを読み込めませんでした。",
    "파일을 가져오지 못했습니다.",
    "Não foi possível importar o arquivo.",
    "Impossibile importare il file."
  ]
};
export const editorMediaBatchCopy: Record<string, Record<string, string>> = Object.fromEntries(locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]!]))]));
