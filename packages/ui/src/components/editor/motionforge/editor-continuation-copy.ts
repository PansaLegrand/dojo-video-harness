import type { Locale } from "@/lib/i18n/dictionary";
const locales = ["zh", "es", "fr", "de", "it", "pt", "ja", "ko"] as const;
type Row = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const rows = {
  "One model-assisted reply is included. Media generation and transcription are charged separately.":
    [
      "包含一次 AI 辅助回复。素材生成与转写单独计费。",
      "Incluye una respuesta asistida por IA. La generación de medios y la transcripción se cobran aparte.",
      "Une réponse assistée par IA est incluse. La génération de médias et la transcription sont facturées séparément.",
      "Eine KI-gestützte Antwort ist enthalten. Mediengenerierung und Transkription werden separat berechnet.",
      "È inclusa una risposta assistita dall’IA. Generazione di contenuti e trascrizione sono addebitate separatamente.",
      "Uma resposta assistida por IA está incluída. Geração de mídia e transcrição são cobradas separadamente.",
      "AIによる回答1回分が含まれます。メディア生成と文字起こしは別料金です。",
      "AI 지원 답변 1회가 포함됩니다. 미디어 생성과 음성 전사는 별도로 과금됩니다.",
    ],
  "The included reply has been used. Start a new edit to continue.": [
    "已使用包含的回复次数。请发起新的编辑以继续。",
    "Ya usaste la respuesta incluida. Inicia una nueva edición para continuar.",
    "La réponse incluse a été utilisée. Démarrez une nouvelle modification pour continuer.",
    "Die enthaltene Antwort wurde genutzt. Starte eine neue Bearbeitung, um fortzufahren.",
    "La risposta inclusa è stata usata. Avvia una nuova modifica per continuare.",
    "A resposta incluída já foi usada. Inicie uma nova edição para continuar.",
    "含まれている回答を使用済みです。続けるには新しい編集を開始してください。",
    "포함된 답변을 사용했습니다. 계속하려면 새 편집을 시작하세요.",
  ],
  "Start a new edit": [
    "发起新的编辑",
    "Iniciar nueva edición",
    "Nouvelle modification",
    "Neue Bearbeitung starten",
    "Avvia una nuova modifica",
    "Iniciar nova edição",
    "新しい編集を開始",
    "새 편집 시작",
  ],
  "Uses standard edit credits when you send.": [
    "发送时按标准编辑价格扣除积分。",
    "Al enviar, se aplican los créditos habituales de edición.",
    "L’envoi utilise les crédits habituels de modification.",
    "Beim Senden gelten die üblichen Bearbeitungskosten.",
    "All’invio vengono usati i normali crediti di modifica.",
    "Ao enviar, são usados os créditos normais de edição.",
    "送信すると通常の編集クレジットを使用します。",
    "전송하면 일반 편집 크레딧이 사용됩니다.",
  ],
  "Retry included reply": [
    "重试包含的回复",
    "Reintentar respuesta incluida",
    "Réessayer la réponse incluse",
    "Enthaltene Antwort erneut senden",
    "Riprova la risposta inclusa",
    "Tentar novamente a resposta incluída",
    "含まれる回答を再試行",
    "포함된 답변 다시 시도",
  ],
  "Reply scope": [
    "回复范围",
    "Alcance de la respuesta",
    "Portée de la réponse",
    "Geltungsbereich der Antwort",
    "Ambito della risposta",
    "Escopo da resposta",
    "回答の対象範囲",
    "답변 적용 범위",
  ],
  "Your reply keeps the original edit scope.": [
    "自由回复保留原始编辑范围。",
    "Tu respuesta mantiene el alcance original de edición.",
    "Votre réponse conserve la portée initiale de la modification.",
    "Deine Antwort behält den ursprünglichen Bearbeitungsumfang bei.",
    "La risposta mantiene l’ambito originale della modifica.",
    "Sua resposta mantém o escopo original da edição.",
    "自由入力の回答では元の編集範囲を維持します。",
    "직접 입력한 답변은 원래 편집 범위를 유지합니다.",
  ],
  "The project changed after this question. Revise the request using the current project.":
    [
      "项目在提问后发生了更改。请根据当前项目修改请求。",
      "El proyecto cambió después de esta pregunta. Revisa la solicitud con el proyecto actual.",
      "Le projet a changé depuis cette question. Révisez la demande avec le projet actuel.",
      "Das Projekt wurde seit dieser Frage geändert. Überarbeite die Anfrage anhand des aktuellen Projekts.",
      "Il progetto è cambiato dopo questa domanda. Rivedi la richiesta usando il progetto attuale.",
      "O projeto mudou após esta pergunta. Revise o pedido usando o projeto atual.",
      "質問後にプロジェクトが変更されました。現在のプロジェクトに合わせて依頼を修正してください。",
      "질문 이후 프로젝트가 변경되었습니다. 현재 프로젝트에 맞게 요청을 수정하세요.",
    ],
  "An included reply is already being submitted. Retry it before choosing another.":
    [
      "包含的回复正在提交。请选择重试后再更换回复。",
      "Ya se está enviando una respuesta incluida. Reinténtala antes de elegir otra.",
      "Une réponse incluse est déjà en cours d’envoi. Réessayez-la avant d’en choisir une autre.",
      "Eine enthaltene Antwort wird bereits gesendet. Versuche es erneut, bevor du eine andere wählst.",
      "Una risposta inclusa è già in invio. Riprovala prima di sceglierne un’altra.",
      "Uma resposta incluída já está sendo enviada. Tente novamente antes de escolher outra.",
      "含まれる回答を送信中です。別の回答を選ぶ前に再試行してください。",
      "포함된 답변을 제출하고 있습니다. 다른 답변을 선택하기 전에 다시 시도하세요.",
    ],
  "Cancellation requested. Waiting for worker confirmation.": [
    "已请求取消，正在等待处理服务确认。",
    "Se solicitó cancelar. Esperando confirmación del servicio.",
    "Annulation demandée. En attente de confirmation du service.",
    "Abbruch angefordert. Warte auf die Bestätigung des Dienstes.",
    "Annullamento richiesto. In attesa della conferma del servizio.",
    "Cancelamento solicitado. Aguardando confirmação do serviço.",
    "キャンセルをリクエストしました。処理サービスの確認を待っています。",
    "취소를 요청했습니다. 처리 서비스의 확인을 기다리고 있습니다.",
  ],
  "Included reply": [
    "包含的回复",
    "Respuesta incluida",
    "Réponse incluse",
    "Enthaltene Antwort",
    "Risposta inclusa",
    "Resposta incluída",
    "含まれる回答",
    "포함된 답변",
  ],
} satisfies Record<string, Row>;
export const EDITOR_CONTINUATION_LABELS = Object.keys(rows) as Array<
  keyof typeof rows
>;
export const editorContinuationCopy = Object.fromEntries(
  locales.map((locale, index) => [
    locale,
    Object.fromEntries(
      Object.entries(rows).map(([key, values]) => [key, values[index]]),
    ),
  ]),
) as Record<Exclude<Locale, "en">, Record<string, string>>;
