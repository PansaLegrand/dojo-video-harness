/** Host policy copy. Product component markup and styles are synced unchanged. */
const localCopy: Record<string, string> = {
  "One model-assisted reply is included. Media generation and transcription are charged separately.":
    "Reply using your configured LLM. Your provider’s usage charges apply.",
  "The included reply has been used. Start a new edit to continue.":
    "This question has been answered. Start a new edit to continue.",
  "Uses standard edit credits when you send.":
    "Uses your configured LLM when you send.",
  "Send applies edits automatically. Required media is uploaded for cloud transcription. Standard edit and transcription credits apply.":
    "Send applies edits automatically. Required media is sent to your configured speech provider. Your providers’ usage charges apply.",
  "Included reply": "Follow-up reply",
  "Retry included reply": "Retry the same reply",
  "Upload this media for cloud transcription":
    "Send this media to my configured ASR provider",
  "Transcription uses credits. Translation uses additional credits when selected.":
    "Your configured providers process the media and text. Their usage charges apply.",
  "Translation uses credits. Your original captions are kept.":
    "Translation uses your configured LLM. Your original captions are kept.",
  "Generate captions · uses credits": "Generate captions · your ASR provider",
  "Add translated track · uses credits": "Add translated track · your LLM",
  "This request needs cloud transcription. Selected local media will be uploaded to storage and the speech provider. Standard transcription credits apply.":
    "This request needs transcription. Selected media will be sent to the local server and your configured speech provider.",
  "Upload to project": "Save to local server",
  "Uploading video…": "Saving to local server…",
  "Save to project outputs": "Save to local server",
  "Saved to outputs": "Saved locally",
  "View saved videos": "View saved videos",
};
export const localEditorCopy = (text: string) => localCopy[text] ?? text;
