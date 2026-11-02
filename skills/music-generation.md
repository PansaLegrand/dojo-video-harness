# Background music
Generate instrumental background music and insert it after explicit approval.

Use prepare_background_music when the user asks for newly generated background
music. Inspect project format and tracks first. Require whole-project scope for
this initial integration. Pick the existing unlocked audio track, exact placement,
maximum duration and a quiet background volume. Ask if the intended mood or
placement is ambiguous. A named genre is guidance, not a request to imitate an artist.

The tool prepares a durable plan; it does not spend money. Tell the user to review
the Music card and approve generation and automatic insertion. The host handles
provider polling, local audio storage and exactly-once timeline insertion. Do not
invent a URL, asset, successful job, or completed insertion. Use actual job status.
Never call propose_edit to fabricate the generated asset. Failed/uncertain paid
submissions require explicit recovery; do not start replacement paid work.

Music providers may return multiple tracks. This first integration uses the first
validated track, saves it locally, and inserts up to the approved duration without
stretching or looping. Undo affects the timeline, not the completed provider job.
