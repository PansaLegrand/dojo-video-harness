const phrases = [
  "Chat",
  "Video agent",
  "Describe your edit…",
  "Using your selection",
  "Using the current project",
  "Send",
  "Review changes",
  "Apply",
  "Before",
  "After",
  "Working…",
  "Queued",
  "Speech context needed",
  "Upload and continue",
  "Upload for transcription",
  "Upload and transcribe",
  "On this device",
  "Cloud available",
  "Relink original file",
  "Graphic layer",
  "Use saved version",
  "Apply my pending changes",
  "Place captions on selected clip",
] as const;
const labels: Record<string, string[]> = {
  zh: [
    "对话",
    "视频智能助手",
    "描述你想做的修改…",
    "使用当前选区",
    "使用当前项目",
    "发送",
    "检查修改",
    "应用",
    "修改前",
    "修改后",
    "正在处理…",
    "已排队",
    "需要语音信息",
    "上传并继续",
    "上传以转录",
    "上传并转录",
    "保存在本机",
    "云端可用",
    "重新关联原文件",
    "图形图层",
    "使用已保存版本",
    "应用我的待保存修改",
    "将字幕放入所选片段",
  ],
  es: [
    "Chat",
    "Agente de video",
    "Describe tu edición…",
    "Usando tu selección",
    "Usando el proyecto actual",
    "Enviar",
    "Revisar cambios",
    "Aplicar",
    "Antes",
    "Después",
    "Procesando…",
    "En cola",
    "Se necesita contexto de voz",
    "Subir y continuar",
    "Subir para transcribir",
    "Subir y transcribir",
    "En este dispositivo",
    "Disponible en la nube",
    "Vincular archivo original",
    "Capa gráfica",
    "Usar versión guardada",
    "Aplicar mis cambios pendientes",
    "Colocar subtítulos en el clip seleccionado",
  ],
  fr: [
    "Discussion",
    "Agent vidéo",
    "Décrivez votre modification…",
    "Votre sélection est utilisée",
    "Le projet actuel est utilisé",
    "Envoyer",
    "Vérifier les modifications",
    "Appliquer",
    "Avant",
    "Après",
    "Traitement…",
    "En attente",
    "Contexte vocal requis",
    "Importer et continuer",
    "Importer pour transcrire",
    "Importer et transcrire",
    "Sur cet appareil",
    "Disponible dans le cloud",
    "Relier le fichier d’origine",
    "Calque graphique",
    "Utiliser la version enregistrée",
    "Appliquer mes modifications en attente",
    "Placer les sous-titres sur le clip sélectionné",
  ],
  de: [
    "Chat",
    "Videoassistent",
    "Beschreibe die Bearbeitung…",
    "Deine Auswahl wird verwendet",
    "Aktuelles Projekt wird verwendet",
    "Senden",
    "Änderungen prüfen",
    "Anwenden",
    "Vorher",
    "Nachher",
    "Wird bearbeitet…",
    "In Warteschlange",
    "Sprachkontext erforderlich",
    "Hochladen und fortfahren",
    "Zur Transkription hochladen",
    "Hochladen und transkribieren",
    "Auf diesem Gerät",
    "In der Cloud verfügbar",
    "Originaldatei neu verknüpfen",
    "Grafikebene",
    "Gespeicherte Version verwenden",
    "Meine ausstehenden Änderungen anwenden",
    "Untertitel im ausgewählten Clip platzieren",
  ],
  it: [
    "Chat",
    "Agente video",
    "Descrivi la modifica…",
    "Usa la selezione",
    "Usa il progetto attuale",
    "Invia",
    "Rivedi modifiche",
    "Applica",
    "Prima",
    "Dopo",
    "Elaborazione…",
    "In coda",
    "Serve il contesto vocale",
    "Carica e continua",
    "Carica per trascrivere",
    "Carica e trascrivi",
    "Su questo dispositivo",
    "Disponibile nel cloud",
    "Ricollega file originale",
    "Livello grafico",
    "Usa versione salvata",
    "Applica le mie modifiche in sospeso",
    "Inserisci sottotitoli nella clip selezionata",
  ],
  pt: [
    "Chat",
    "Agente de vídeo",
    "Descreva sua edição…",
    "Usando sua seleção",
    "Usando o projeto atual",
    "Enviar",
    "Revisar alterações",
    "Aplicar",
    "Antes",
    "Depois",
    "Processando…",
    "Na fila",
    "Contexto de fala necessário",
    "Enviar e continuar",
    "Enviar para transcrição",
    "Enviar e transcrever",
    "Neste dispositivo",
    "Disponível na nuvem",
    "Revincular arquivo original",
    "Camada gráfica",
    "Usar versão salva",
    "Aplicar minhas alterações pendentes",
    "Colocar legendas no clipe selecionado",
  ],
  ko: [
    "채팅",
    "영상 에이전트",
    "원하는 편집을 설명하세요…",
    "선택 항목 사용",
    "현재 프로젝트 사용",
    "보내기",
    "변경 검토",
    "적용",
    "변경 전",
    "변경 후",
    "처리 중…",
    "대기 중",
    "음성 정보 필요",
    "업로드하고 계속",
    "받아쓰기를 위해 업로드",
    "업로드하고 받아쓰기",
    "이 기기에 저장됨",
    "클라우드에서 사용 가능",
    "원본 파일 다시 연결",
    "그래픽 레이어",
    "저장된 버전 사용",
    "내 미저장 변경 적용",
    "선택한 클립에 자막 배치",
  ],
  ja: [
    "チャット",
    "動画エージェント",
    "編集内容を説明…",
    "選択した項目を使用",
    "現在のプロジェクトを使用",
    "送信",
    "変更を確認",
    "適用",
    "変更前",
    "変更後",
    "処理中…",
    "待機中",
    "音声情報が必要",
    "アップロードして続行",
    "文字起こし用にアップロード",
    "アップロードして文字起こし",
    "このデバイスに保存",
    "クラウドで利用可能",
    "元のファイルを再リンク",
    "グラフィックレイヤー",
    "保存済みバージョンを使用",
    "保留中の変更を適用",
    "選択したクリップに字幕を配置",
  ],
};
export const workspaceCopy = Object.fromEntries(
  Object.entries(labels).map(([locale, values]) => [
    locale,
    Object.fromEntries(
      phrases.map((phrase, index) => [phrase, values[index]!]),
    ),
  ]),
) as Record<string, Record<string, string>>;
const descriptions: Record<string, [string, string]> = {
  zh: [
    "描述修改、询问所选片段，或创建动态图形。对话与手动操作共用一份编辑历史。",
    "此请求需要云端转录。本地素材将上传到存储服务和语音服务商，并按标准扣除转录积分。",
  ],
  es: [
    "Describe una edición, pregunta sobre el clip seleccionado o crea gráficos animados. El chat y los controles comparten un historial.",
    "Esta solicitud necesita transcripción en la nube. Los archivos locales se subirán al almacenamiento y al proveedor de voz. Se aplican los créditos de transcripción habituales.",
  ],
  fr: [
    "Décrivez une modification, posez une question sur le clip sélectionné ou créez une animation. La discussion et les commandes partagent un historique.",
    "Cette demande nécessite une transcription cloud. Les fichiers locaux seront envoyés au stockage et au fournisseur vocal. Les crédits de transcription habituels s’appliquent.",
  ],
  de: [
    "Beschreibe eine Bearbeitung, frage zum ausgewählten Clip oder erstelle eine animierte Grafik. Chat und manuelle Steuerung teilen einen Verlauf.",
    "Diese Anfrage benötigt eine Cloud-Transkription. Lokale Medien werden zum Speicher und Sprachanbieter hochgeladen. Es gelten die üblichen Transkriptionscredits.",
  ],
  it: [
    "Descrivi una modifica, chiedi informazioni sulla clip selezionata o crea una grafica animata. Chat e controlli condividono la cronologia.",
    "Questa richiesta richiede la trascrizione nel cloud. I file locali saranno caricati nello spazio di archiviazione e al fornitore vocale. Si applicano i normali crediti di trascrizione.",
  ],
  pt: [
    "Descreva uma edição, pergunte sobre o clipe selecionado ou crie gráficos animados. O chat e os controles compartilham um histórico.",
    "Esta solicitação precisa de transcrição na nuvem. Os arquivos locais serão enviados ao armazenamento e ao provedor de voz. Aplicam-se os créditos habituais de transcrição.",
  ],
  ko: [
    "편집을 설명하거나 선택한 클립에 대해 질문하거나 모션 그래픽을 만드세요. 채팅과 수동 조작은 하나의 편집 기록을 공유합니다.",
    "이 요청에는 클라우드 받아쓰기가 필요합니다. 로컬 미디어가 저장소와 음성 제공업체로 업로드되며 일반 받아쓰기 크레딧이 사용됩니다.",
  ],
  ja: [
    "編集内容や選択したクリップへの質問を入力するか、モーショングラフィックスを作成できます。チャットと手動操作は同じ履歴を共有します。",
    "このリクエストにはクラウド文字起こしが必要です。ローカルメディアがストレージと音声サービスにアップロードされ、通常の文字起こしクレジットが適用されます。",
  ],
};
for (const [locale, [intro, consent]] of Object.entries(descriptions)) {
  workspaceCopy[locale]![
    "Describe an edit, ask about the selected clip, or create a motion graphic. Chat and manual controls share one history."
  ] = intro;
  workspaceCopy[locale]![
    "This request needs cloud transcription. Selected local media will be uploaded to storage and the speech provider. Standard transcription credits apply."
  ] = consent;
  workspaceCopy[locale]![
    "Transcription sends this media to cloud storage and the speech provider. Preview and manual editing stay local. Standard transcription credits apply."
  ] = consent;
}

const recovery: Record<string, [string, string]> = {
  zh: ["重试同一请求", "修改请求"],
  es: ["Reintentar la misma solicitud", "Revisar solicitud"],
  fr: ["Réessayer la même demande", "Modifier la demande"],
  de: ["Dieselbe Anfrage erneut versuchen", "Anfrage überarbeiten"],
  it: ["Riprova la stessa richiesta", "Rivedi richiesta"],
  pt: ["Tentar a mesma solicitação", "Revisar solicitação"],
  ko: ["같은 요청 재시도", "요청 수정"],
  ja: ["同じリクエストを再試行", "リクエストを修正"],
};
for (const [locale, values] of Object.entries(recovery)) {
  workspaceCopy[locale]!["Retry same request"] = values[0];
  workspaceCopy[locale]!["Revise request"] = values[1];
}

const vision: Record<string, string> = {
  zh: "附上当前预览画面 · 将此图片发送给模型",
  es: "Incluir el fotograma actual · envía esta imagen al modelo",
  fr: "Inclure l’image actuelle · l’envoyer au modèle",
  de: "Aktuelles Vorschaubild einschließen · sendet es an das Modell",
  it: "Includi il fotogramma attuale · invia l’immagine al modello",
  pt: "Incluir quadro atual · envia esta imagem ao modelo",
  ko: "현재 미리보기 프레임 포함 · 이 이미지를 모델에 전송",
  ja: "現在のプレビューフレームを含める · この画像をモデルに送信",
};
for (const [locale, text] of Object.entries(vision))
  workspaceCopy[locale]![
    "Include current preview frame · sends this image to the model"
  ] = text;

const recoverResult: Record<string, string> = {
  zh: "恢复结果",
  es: "Recuperar resultado",
  fr: "Récupérer le résultat",
  de: "Ergebnis wiederherstellen",
  it: "Recupera risultato",
  pt: "Recuperar resultado",
  ko: "결과 복구",
  ja: "結果を復元",
};
for (const [locale, text] of Object.entries(recoverResult))
  workspaceCopy[locale]!["Recover result"] = text;

const editingLayer: Record<string, string> = {
  zh: "编辑图层",
  es: "Capa de edición",
  fr: "Calque à modifier",
  de: "Ebene bearbeiten",
  it: "Livello da modificare",
  pt: "Camada de edição",
  ko: "편집 레이어",
  ja: "編集レイヤー",
};
for (const [locale, text] of Object.entries(editingLayer))
  workspaceCopy[locale]!["Editing layer"] = text;

const speechLinks: Record<string, [string, string, string]> = {
  zh: ["已关联语音", "语音锚点在源片段之外", "取消语音关联"],
  es: [
    "Vinculado a la voz",
    "El ancla de voz queda fuera del clip fuente",
    "Desvincular de la voz",
  ],
  fr: [
    "Lié à la parole",
    "Le repère vocal est hors du clip source",
    "Dissocier de la parole",
  ],
  de: [
    "Mit Sprache verknüpft",
    "Sprachanker liegt außerhalb des Quellclips",
    "Sprachverknüpfung lösen",
  ],
  it: [
    "Collegato al parlato",
    "L’ancora vocale è fuori dalla clip sorgente",
    "Scollega dal parlato",
  ],
  pt: [
    "Vinculado à fala",
    "A âncora de fala está fora do clipe de origem",
    "Desvincular da fala",
  ],
  ko: [
    "음성에 연결됨",
    "음성 기준점이 원본 클립 밖에 있습니다",
    "음성 연결 해제",
  ],
  ja: [
    "音声にリンク済み",
    "音声アンカーが元クリップの範囲外です",
    "音声リンクを解除",
  ],
};
for (const [locale, [linked, outside, unlink]] of Object.entries(speechLinks)) {
  workspaceCopy[locale]!["Linked to speech"] = linked;
  workspaceCopy[locale]!["Speech anchor is outside the source clip"] = outside;
  workspaceCopy[locale]!["Unlink from speech"] = unlink;
}

const cachedGraphics: Record<string, [string, string]> = {
  zh: [
    "恢复已生成图形",
    "在播放头位置复用已生成图形，并取消先前的语音关联。应用前可检查，不消耗生成积分。",
  ],
  es: [
    "Recuperar gráfico guardado",
    "Reutiliza el gráfico en el cabezal, sin su vínculo de voz anterior. Revisa antes de aplicar; no consume créditos de generación.",
  ],
  fr: [
    "Récupérer le graphique",
    "Réutilisez le graphique à la tête de lecture, sans son ancien lien vocal. Vérifiez avant d’appliquer ; aucun crédit de génération.",
  ],
  de: [
    "Gespeicherte Grafik wiederverwenden",
    "Grafik am Abspielkopf ohne bisherigen Sprachanker wiederverwenden. Vor dem Anwenden prüfen; keine Generierungscredits.",
  ],
  it: [
    "Recupera grafica salvata",
    "Riutilizza la grafica sulla testina, senza il precedente collegamento vocale. Rivedi prima di applicare; nessun credito di generazione.",
  ],
  pt: [
    "Recuperar gráfico salvo",
    "Reutilize o gráfico no cursor, sem o vínculo de fala anterior. Revise antes de aplicar; sem créditos de geração.",
  ],
  ko: [
    "저장된 그래픽 복구",
    "이전 음성 연결을 해제하고 재생 헤드에서 그래픽을 다시 사용합니다. 적용 전에 검토하며 생성 크레딧은 사용하지 않습니다.",
  ],
  ja: [
    "保存済みグラフィックを復元",
    "以前の音声リンクを解除し、再生ヘッド位置でグラフィックを再利用します。適用前に確認でき、生成クレジットは不要です。",
  ],
};
for (const [locale, [action, description]] of Object.entries(cachedGraphics)) {
  workspaceCopy[locale]!["Recover saved graphic"] = action;
  workspaceCopy[locale]![
    "Reuse the saved graphic at the playhead, detached from its previous speech link. Review before applying; no generation credits."
  ] = description;
}
