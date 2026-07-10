# Preserve authenticated evidence only by operator opt-in

NullTrace will retain raw authenticated scanner request and response material only when the operator explicitly enables preservation for that individual run. Preserved material is encrypted and isolated from source context, standard logs, and chat because authenticated transcripts can contain credentials, personal data, and other sensitive target data while still being useful evidence for later finding verification.
