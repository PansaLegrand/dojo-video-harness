import type { Locale } from "@/lib/i18n/dictionary";

const locales = ["zh", "es", "fr", "de", "it", "pt", "ja", "ko"] as const;
type Row = readonly [string, string, string, string, string, string, string, string];
const rows = {
  "Original files needed": ["需要重新选择原始文件", "Se necesitan los archivos originales", "Fichiers d’origine nécessaires", "Originaldateien benötigt", "Servono i file originali", "Arquivos originais necessários", "元のファイルが必要です", "원본 파일이 필요합니다"],
  "Some media could not be loaded": ["部分素材无法加载", "No se pudieron cargar algunos archivos", "Certains médias n’ont pas pu être chargés", "Einige Medien konnten nicht geladen werden", "Impossibile caricare alcuni contenuti", "Não foi possível carregar alguns arquivos", "一部のメディアを読み込めませんでした", "일부 미디어를 불러오지 못했습니다"],
  "This browser cannot access the original files. They may be stored in another browser or device, or browser storage may have been cleared.": [
    "当前浏览器无法读取原始文件。文件可能保存在其他浏览器或设备中，也可能是浏览器存储已被清理。",
    "Este navegador no puede acceder a los archivos originales. Puede que estén en otro navegador o dispositivo, o que se haya borrado el almacenamiento del navegador.",
    "Ce navigateur ne peut pas accéder aux fichiers d’origine. Ils peuvent être stockés dans un autre navigateur ou appareil, ou le stockage du navigateur a peut-être été effacé.",
    "Dieser Browser kann nicht auf die Originaldateien zugreifen. Sie sind möglicherweise in einem anderen Browser oder auf einem anderen Gerät gespeichert, oder der Browserspeicher wurde gelöscht.",
    "Questo browser non può accedere ai file originali. Potrebbero essere in un altro browser o dispositivo, oppure la memoria del browser potrebbe essere stata cancellata.",
    "Este navegador não consegue acessar os arquivos originais. Eles podem estar em outro navegador ou dispositivo, ou o armazenamento do navegador pode ter sido apagado.",
    "このブラウザでは元のファイルにアクセスできません。別のブラウザや端末に保存されているか、ブラウザの保存データが削除された可能性があります。",
    "이 브라우저에서 원본 파일에 접근할 수 없습니다. 다른 브라우저나 기기에 저장되어 있거나 브라우저 저장 데이터가 삭제되었을 수 있습니다."
  ],
  "Your edits are still in this project. Choose the original files to restore preview and export.": [
    "项目中的剪辑内容仍然保留。重新选择原始文件即可恢复预览和导出。",
    "Tus ediciones siguen en este proyecto. Selecciona los archivos originales para recuperar la vista previa y la exportación.",
    "Vos modifications sont toujours dans ce projet. Sélectionnez les fichiers d’origine pour rétablir l’aperçu et l’exportation.",
    "Deine Bearbeitungen sind weiterhin in diesem Projekt vorhanden. Wähle die Originaldateien aus, um Vorschau und Export wieder zu nutzen.",
    "Le tue modifiche sono ancora nel progetto. Seleziona i file originali per ripristinare l’anteprima e l’esportazione.",
    "Suas edições continuam neste projeto. Selecione os arquivos originais para restaurar a prévia e a exportação.",
    "編集内容はこのプロジェクトに残っています。元のファイルを選択すると、プレビューと書き出しを再開できます。",
    "편집 내용은 프로젝트에 남아 있습니다. 원본 파일을 선택하면 미리보기와 내보내기를 다시 사용할 수 있습니다."
  ],
  "Some project files are unavailable. Check your connection and try loading them again.": [
    "部分项目文件暂时不可用。请检查网络连接后重试加载。",
    "Algunos archivos del proyecto no están disponibles. Comprueba tu conexión e intenta cargarlos de nuevo.",
    "Certains fichiers du projet sont indisponibles. Vérifiez votre connexion et réessayez de les charger.",
    "Einige Projektdateien sind nicht verfügbar. Prüfe deine Verbindung und versuche erneut, sie zu laden.",
    "Alcuni file del progetto non sono disponibili. Controlla la connessione e riprova a caricarli.",
    "Alguns arquivos do projeto estão indisponíveis. Verifique sua conexão e tente carregá-los novamente.",
    "一部のプロジェクトファイルを利用できません。接続を確認して、もう一度読み込んでください。",
    "일부 프로젝트 파일을 사용할 수 없습니다. 연결을 확인한 후 다시 불러오세요."
  ],
  "Choose original file": ["选择原始文件", "Seleccionar archivo original", "Choisir le fichier d’origine", "Originaldatei auswählen", "Scegli il file originale", "Selecionar arquivo original", "元のファイルを選択", "원본 파일 선택"],
  "Retry loading files": ["重新加载文件", "Volver a cargar los archivos", "Réessayer le chargement", "Dateien erneut laden", "Riprova a caricare i file", "Tentar carregar novamente", "ファイルを再読み込み", "파일 다시 불러오기"],
  "Unnamed media file": ["未命名素材", "Archivo sin nombre", "Fichier sans nom", "Unbenannte Mediendatei", "File senza nome", "Arquivo sem nome", "名前のないメディアファイル", "이름 없는 미디어 파일"],
  "This is a different file. Relink using the original media; import new footage separately.": [
    "所选文件与原始文件不同。请选择最初导入的文件；如需使用其他素材，请单独导入。",
    "El archivo seleccionado es diferente. Selecciona el archivo original; importa el material nuevo por separado.",
    "Le fichier sélectionné est différent. Choisissez le fichier d’origine ; importez les nouveaux médias séparément.",
    "Die ausgewählte Datei ist eine andere. Wähle die Originaldatei aus; importiere neues Material separat.",
    "Il file selezionato è diverso. Scegli il file originale; importa separatamente i nuovi contenuti.",
    "O arquivo selecionado é diferente. Selecione o original; importe novos arquivos separadamente.",
    "選択したファイルは元のファイルと異なります。最初に読み込んだファイルを選択してください。新しい素材は別途読み込んでください。",
    "선택한 파일이 원본과 다릅니다. 처음 가져온 파일을 선택하세요. 새 미디어는 별도로 가져와 주세요."
  ],
} satisfies Record<string, Row>;

export const editorMissingMediaCopy = Object.fromEntries(locales.map((locale, index) => [locale,
  Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]])),
])) as Record<Exclude<Locale, "en">, Record<string, string>>;
